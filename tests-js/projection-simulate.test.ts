import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../src/domain/projection-simulate.ts";
import type { ProjectionInput, Flow } from "../src/domain/projection.ts";
import type { CycleVersion } from "../src/domain/card-competence.ts";

function out(
  key: string,
  date: string,
  cents: bigint,
  cons?: { date?: string; cents?: bigint },
): Flow {
  return {
    key,
    direction: "out",
    nom: { date, cents },
    cons: { date: cons?.date ?? date, cents: cons?.cents ?? cents },
  };
}
function income(key: string, date: string, cents: bigint): Flow {
  return {
    key,
    direction: "in",
    nom: { date, cents },
    cons: { date, cents },
  };
}

// Fixture F (mesma de projection.test.ts): cCons 74262, mínimo em 2026-12-01.
const fixtureF: ProjectionInput = {
  today: "2026-11-09",
  horizonEnd: "2027-01-04",
  sConf: 410000n,
  cushion: 20000n,
  flows: [
    out("mercado-nov", "2026-11-09", 60000n),
    out("condominio-nov", "2026-11-10", 78000n),
    out("reserva-viagem", "2026-11-10", 30000n),
    out("academia-nov", "2026-11-12", 9900n),
    out("internet-nov", "2026-11-15", 12000n),
    out("fatura-nov", "2026-11-20", 109000n, { cents: 115000n }),
    out("mercado-dez-1", "2026-12-01", 10322n, { cents: 10838n }),
    out("mercado-dez-2", "2026-12-05", 69678n, { cents: 73162n }),
    out("condominio-dez", "2026-12-10", 78000n),
    out("academia-dez", "2026-12-12", 9900n),
    out("internet-dez", "2026-12-15", 12000n),
    out("fatura-dez", "2026-12-20", 48200n),
    income("salario", "2026-12-05", 620000n),
  ],
};

// Ciclo que fecha dia 13 e vence dia 20 (offset 0), vigente em toda a fixture.
const cycles: CycleVersion[] = [
  {
    closing_day: 13,
    due_day: 20,
    due_month_offset: 0,
    valid_from: "2026-01-01",
    valid_until: null,
  },
];

test("cash 60000 hoje -> deltaCCons -60000", () => {
  const r = simulate(fixtureF, {
    cents: 60000n,
    day: "2026-11-09",
    method: "cash",
    installments: 1,
  });
  assert.equal(r.before.cCons, 74262n);
  assert.equal(r.after.cCons, 14262n);
  assert.equal(r.deltaCCons, -60000n);
  assert.deepEqual(r.byMonth, [{ month: "2026-11", cents: 60000n }]);
});

test("card 60000 em 11-13 -> sai 11-20, delta -60000 (antes do mínimo)", () => {
  const r = simulate(fixtureF, {
    cents: 60000n,
    day: "2026-11-13",
    method: "card",
    installments: 1,
    cycles,
  });
  assert.equal(r.deltaCCons, -60000n);
  assert.deepEqual(r.byMonth, [{ month: "2026-11", cents: 60000n }]);
  // Saída caiu em 11-20 (vencimento), não em 12-20.
  assert.equal(r.after.cCons, 14262n);
});

test("card 60000 em 11-14 -> sai 12-20, delta 0 (depois do mínimo e do salário)", () => {
  const r = simulate(fixtureF, {
    cents: 60000n,
    day: "2026-11-14",
    method: "card",
    installments: 1,
    cycles,
  });
  assert.equal(r.deltaCCons, 0n);
  assert.deepEqual(r.byMonth, [{ month: "2026-12", cents: 60000n }]);
});

test("3x de 60000 a partir de 11-14 -> byMonth 12:20000, 01:20000, 02:20000", () => {
  const r = simulate(fixtureF, {
    cents: 60000n,
    day: "2026-11-14",
    method: "card",
    installments: 3,
    cycles,
  });
  assert.deepEqual(r.byMonth, [
    { month: "2026-12", cents: 20000n },
    { month: "2027-01", cents: 20000n },
    { month: "2027-02", cents: 20000n },
  ]);
  // Soma byMonth == cents.
  assert.equal(
    r.byMonth.reduce((s, m) => s + m.cents, 0n),
    60000n,
  );
});

test("parcela fora do horizonte (02-20) não entra no after mas aparece em byMonth", () => {
  const r = simulate(fixtureF, {
    cents: 60000n,
    day: "2026-11-14",
    method: "card",
    installments: 3,
    cycles,
  });
  // after termina em 2027-01-04: nenhum dia 2027-02-20 na série.
  assert.ok(!r.after.series.some((p) => p.day === "2027-02-20"));
  // Mas byMonth lista 2027-02.
  assert.ok(r.byMonth.some((m) => m.month === "2027-02" && m.cents === 20000n));
});

test("resto da divisão vai na última parcela", () => {
  const r = simulate(fixtureF, {
    cents: 100n,
    day: "2026-11-14",
    method: "card",
    installments: 3,
    cycles,
  });
  // floor(100/3)=33, 33, 34.
  assert.deepEqual(r.byMonth, [
    { month: "2026-12", cents: 33n },
    { month: "2027-01", cents: 33n },
    { month: "2027-02", cents: 34n },
  ]);
  assert.equal(
    r.byMonth.reduce((s, m) => s + m.cents, 0n),
    100n,
  );
});

test("card sem ciclo -> erro de domínio", () => {
  assert.throws(
    () =>
      simulate(fixtureF, {
        cents: 60000n,
        day: "2026-11-14",
        method: "card",
        installments: 1,
      }),
    /ciclo/i,
  );
});

test("soma byMonth == cents sempre (cash com valor quebrado)", () => {
  const r = simulate(fixtureF, {
    cents: 12345n,
    day: "2026-11-09",
    method: "cash",
    installments: 1,
  });
  assert.equal(
    r.byMonth.reduce((s, m) => s + m.cents, 0n),
    12345n,
  );
});
