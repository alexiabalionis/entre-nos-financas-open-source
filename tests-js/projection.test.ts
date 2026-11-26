import { test } from "node:test";
import assert from "node:assert/strict";
import {
  project,
  capacityFrom,
  type Flow,
  type ProjectionInput,
} from "../src/domain/projection.ts";

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

const expectedF: Record<string, [bigint, bigint]> = {
  "2026-11-09": [350000n, 350000n],
  "2026-11-10": [242000n, 242000n],
  "2026-11-12": [232100n, 232100n],
  "2026-11-15": [220100n, 220100n],
  "2026-11-20": [111100n, 105100n],
  "2026-12-01": [100778n, 94262n],
  "2026-12-05": [651100n, 641100n],
  "2026-12-10": [573100n, 563100n],
  "2026-12-12": [563200n, 553200n],
  "2026-12-15": [551200n, 541200n],
  "2026-12-20": [503000n, 493000n],
  "2027-01-04": [503000n, 493000n],
};

test("fixture F: série diária, mínimos com colchão e D sem previsão não iniciada", () => {
  const r = project(fixtureF);
  const byDay = new Map(r.series.map((p) => [p.day, p]));
  for (const [day, [nom, cons]] of Object.entries(expectedF)) {
    const point = byDay.get(day);
    assert.ok(point, `dia ${day} ausente na série`);
    assert.equal(point.nom, nom, `nom em ${day}`);
    assert.equal(point.cons, cons, `cons em ${day}`);
  }
  assert.equal(r.series[0].day, "2026-11-09");
  assert.equal(r.series.at(-1)?.day, "2027-01-04");
  assert.equal(r.cNom, 80778n);
  assert.equal(r.cCons, 74262n);
  assert.equal(r.low.nom.day, "2026-12-01");
  assert.equal(r.low.cons.day, "2026-12-01");
  assert.equal(r.D, 410000n);
  assert.equal(r.deficit, null);
  assert.equal(r.negative, null);
});

test("fixture F: invariantes e capacidade a partir de uma data", () => {
  const r = project(fixtureF);
  assert.ok(r.cCons <= r.cNom);
  assert.ok(r.cCons <= r.series[0].cons - fixtureF.cushion);
  const saidas =
    60000n +
    78000n +
    30000n +
    9900n +
    12000n +
    115000n +
    10838n +
    73162n +
    78000n +
    9900n +
    12000n +
    48200n;
  const entradas = 620000n;
  assert.equal(r.series.at(-1)?.cons, fixtureF.sConf + entradas - saidas);
  assert.equal(capacityFrom(r, 20000n, "2026-12-06"), 473000n);
});

const scenarioH: ProjectionInput = {
  today: "2026-11-09",
  horizonEnd: "2026-12-04",
  sConf: 150000n,
  cushion: 20000n,
  flows: [
    out("condominio", "2026-11-10", 78000n),
    out("fatura", "2026-11-20", 115000n),
  ],
};

test("cenário H: déficit e saldo negativo no mesmo dia do mínimo", () => {
  const r = project(scenarioH);
  const byDay = new Map(r.series.map((p) => [p.day, p]));
  assert.equal(byDay.get("2026-11-10")?.cons, 72000n);
  assert.equal(byDay.get("2026-11-20")?.cons, -43000n);
  assert.equal(r.cCons, -63000n);
  assert.deepEqual(r.deficit, { cents: 63000n, day: "2026-11-20" });
  assert.deepEqual(r.negative, { cents: 43000n, day: "2026-11-20" });
  assert.equal(r.D, 150000n);
  assert.ok(r.cCons <= r.cNom);
  assert.ok(r.cCons <= r.series[0].cons - scenarioH.cushion);
});

test("PIX agendado initiated reduz D e entra na série", () => {
  const pix: Flow = {
    key: "pix-hoje",
    direction: "out",
    nom: { date: "2026-11-09", cents: 5000n },
    cons: { date: "2026-11-09", cents: 5000n },
    initiated: true,
  };
  const r = project({ ...fixtureF, flows: [pix] });
  assert.equal(r.D, 410000n - 5000n);
  assert.equal(r.series[0].cons, 410000n - 5000n);
});

test("previsão (não iniciada) de hoje não reduz D mas entra na série", () => {
  const r = project({
    today: "2026-11-09",
    horizonEnd: "2026-11-11",
    sConf: 100000n,
    cushion: 0n,
    flows: [out("mercado", "2026-11-09", 5000n)],
  });
  assert.equal(r.D, 100000n);
  assert.equal(r.series[0].cons, 95000n);
});

test("fluxo vencido entra em today; fluxo após horizonEnd é ignorado", () => {
  const r = project({
    today: "2026-11-09",
    horizonEnd: "2026-11-11",
    sConf: 100000n,
    cushion: 0n,
    flows: [
      out("vencido", "2026-11-05", 4000n),
      out("futuro", "2026-12-01", 9000n),
    ],
  });
  assert.equal(r.series[0].cons, 96000n);
  assert.equal(r.series.at(-1)?.cons, 96000n);
});

test("mover uma saída de 15/11 para 25/11 mantém o saldo final e muda só os dias entre elas", () => {
  const base: ProjectionInput = {
    today: "2026-11-10",
    horizonEnd: "2026-11-30",
    sConf: 100000n,
    cushion: 0n,
    flows: [out("conta", "2026-11-15", 20000n)],
  };
  const moved: ProjectionInput = {
    ...base,
    flows: [out("conta", "2026-11-25", 20000n)],
  };
  const a = project(base);
  const b = project(moved);
  assert.equal(a.series.at(-1)?.cons, b.series.at(-1)?.cons);
  const byA = new Map(a.series.map((p) => [p.day, p.cons]));
  const byB = new Map(b.series.map((p) => [p.day, p.cons]));
  assert.equal(byA.get("2026-11-14"), byB.get("2026-11-14"));
  assert.notEqual(byA.get("2026-11-20"), byB.get("2026-11-20"));
  assert.equal(byA.get("2026-11-25"), byB.get("2026-11-25"));
});

test("embaralhar flows dá resultado idêntico e não muta o input", () => {
  const shuffled = [...fixtureF.flows].reverse();
  const copy = { ...fixtureF, flows: shuffled };
  const a = project(fixtureF);
  const b = project(copy);
  assert.deepEqual(b.series, a.series);
  assert.equal(b.cCons, a.cCons);
  assert.equal(shuffled.length, fixtureF.flows.length);
});

test("horizonte terminando antes de hoje lança erro de domínio", () => {
  assert.throws(
    () =>
      project({
        today: "2026-11-09",
        horizonEnd: "2026-11-08",
        sConf: 0n,
        cushion: 0n,
        flows: [],
      }),
    /Horizonte da projeção termina antes de hoje\./,
  );
});

test("saída initiated vencida reduz D e cai em today", () => {
  const vencidaIniciada: Flow = {
    key: "pix-vencido",
    direction: "out",
    nom: { date: "2026-10-01", cents: 300n },
    cons: { date: "2026-10-01", cents: 300n },
    initiated: true,
  };
  const r = project({
    today: "2026-11-09",
    horizonEnd: "2026-11-11",
    sConf: 1000n,
    cushion: 0n,
    flows: [vencidaIniciada],
  });
  assert.equal(r.D, 700n);
  assert.equal(r.series[0].cons, 700n);
});

test("key duplicada lança; valor negativo lança", () => {
  assert.throws(() =>
    project({
      today: "2026-11-09",
      horizonEnd: "2026-11-10",
      sConf: 0n,
      cushion: 0n,
      flows: [out("a", "2026-11-09", 1n), out("a", "2026-11-10", 1n)],
    }),
  );
  assert.throws(() =>
    project({
      today: "2026-11-09",
      horizonEnd: "2026-11-10",
      sConf: 0n,
      cushion: 0n,
      flows: [out("a", "2026-11-09", -1n)],
    }),
  );
});
