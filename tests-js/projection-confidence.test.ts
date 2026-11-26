import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessConfidence,
  type ConfidenceInput,
  type GapFlow,
} from "../src/domain/projection-confidence.ts";
import type { Quality } from "../src/domain/projection-reconcile.ts";

function out(
  key: string,
  date: string,
  cents: bigint,
  quality: GapFlow["quality"],
  cons?: { date?: string; cents?: bigint },
): GapFlow {
  return {
    key,
    direction: "out",
    nom: { date, cents },
    cons: { date: cons?.date ?? date, cents: cons?.cents ?? cents },
    quality,
  };
}
function income(
  key: string,
  date: string,
  cents: bigint,
  quality: GapFlow["quality"],
  cons?: { date?: string; cents?: bigint },
): GapFlow {
  return {
    key,
    direction: "in",
    nom: { date, cents },
    cons: { date: cons?.date ?? date, cents: cons?.cents ?? cents },
    quality,
  };
}

// Fixture F: mesmos fluxos de tests-js/projection.test.ts, agora com a qualidade
// de conciliação marcada por fluxo. fatura-nov inconsistent (nom 109000 /
// cons 115000); mercado-dez-1 e -2 estimated; academia-nov e -dez estimated;
// o resto planned/structural.
function fixtureF(
  overrides?: Partial<ConfidenceInput>,
  quality?: (key: string) => GapFlow["quality"],
): ConfidenceInput {
  const q = quality ?? (() => "planned" as Quality);
  return {
    today: "2026-11-09",
    horizonEnd: "2027-01-04",
    sConf: 410000n,
    cushion: 20000n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    flows: [
      out("mercado-nov", "2026-11-09", 60000n, q("mercado-nov")),
      out("condominio-nov", "2026-11-10", 78000n, q("condominio-nov")),
      out("reserva-viagem", "2026-11-10", 30000n, q("reserva-viagem")),
      out("academia-nov", "2026-11-12", 9900n, q("academia-nov")),
      out("internet-nov", "2026-11-15", 12000n, q("internet-nov")),
      out("fatura-nov", "2026-11-20", 109000n, q("fatura-nov"), {
        cents: 115000n,
      }),
      out("mercado-dez-1", "2026-12-01", 10322n, q("mercado-dez-1"), {
        cents: 10838n,
      }),
      out("mercado-dez-2", "2026-12-05", 69678n, q("mercado-dez-2"), {
        cents: 73162n,
      }),
      out("condominio-dez", "2026-12-10", 78000n, q("condominio-dez")),
      out("academia-dez", "2026-12-12", 9900n, q("academia-dez")),
      out("internet-dez", "2026-12-15", 12000n, q("internet-dez")),
      out("fatura-dez", "2026-12-20", 48200n, q("fatura-dez")),
      income("salario", "2026-12-05", 620000n, q("salario")),
    ],
    ...overrides,
  };
}

const markedQuality = (key: string): GapFlow["quality"] => {
  if (key === "fatura-nov") return "inconsistent";
  if (
    key === "mercado-dez-1" ||
    key === "mercado-dez-2" ||
    key === "academia-nov" ||
    key === "academia-dez"
  )
    return "estimated";
  return "planned";
};

test("fixture F com qualidades marcadas: COM_RESSALVA, impactos por lacuna", () => {
  const r = assessConfidence(fixtureF(undefined, markedQuality));
  assert.equal(r.state, "COM_RESSALVA");
  assert.equal(r.shown, 74262n);
  assert.equal(r.result.cCons, 74262n);

  const impact = new Map(r.gaps.map((g) => [g.key, g.impact]));
  assert.equal(impact.get("fatura-nov"), 6000n);
  assert.equal(impact.get("mercado-dez-1"), 516n);
  assert.equal(impact.get("mercado-dez-2"), 0n);
  assert.equal(impact.get("academia-nov"), 0n);
  assert.equal(impact.get("academia-dez"), 0n);

  // Só as 5 lacunas (estimated/inconsistent) entram em gaps.
  assert.equal(r.gaps.length, 5);
  // Ordem: impacto desc, depois key. fatura-nov primeiro.
  assert.equal(r.gaps[0].key, "fatura-nov");
  assert.equal(r.gaps[1].key, "mercado-dez-1");
  // Empate em 0: ordena por key asc.
  assert.deepEqual(
    r.gaps.slice(2).map((g) => g.key),
    ["academia-dez", "academia-nov", "mercado-dez-2"],
  );
  assert.deepEqual(r.needed, []);
});

test("fixture F com tudo planned: CONFIRMADO, sem lacunas", () => {
  const r = assessConfidence(fixtureF());
  assert.equal(r.state, "CONFIRMADO");
  assert.equal(r.shown, 74262n);
  assert.equal(r.gaps.length, 0);
  assert.deepEqual(r.needed, []);
});

test("cenário H: sem folga nem no melhor caso -> SEM_FOLGA", () => {
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-12-04",
    sConf: 150000n,
    cushion: 20000n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    flows: [
      out("condominio", "2026-11-10", 78000n, "planned"),
      out("fatura", "2026-11-20", 115000n, "planned"),
    ],
  });
  assert.equal(r.state, "SEM_FOLGA");
  assert.equal(r.shown, null);
});

test("DEPENDE_DE_DADOS: cNom>0>=cCons, needed mínimo e lacuna pequena fica fora", () => {
  // sConf 100000, cushion 0. Duas saídas estimated no mesmo dia (o mínimo):
  //  grande: nom 60000 / cons 95000  -> impacto 35000
  //  pequena: nom 5000  / cons 20000 -> impacto 15000
  // cNom = 100000 - (60000+5000) = 35000 (>0)
  // cCons = 100000 - (95000+20000) = -15000 (<=0)
  // target = -cCons = 15000. prefixo por impacto desc: grande (35000) já
  // passa de 15000 -> needed = [grande]; a pequena fica de fora.
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 100000n,
    cushion: 0n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    flows: [
      out("grande", "2026-11-15", 60000n, "estimated", { cents: 95000n }),
      out("pequena", "2026-11-16", 5000n, "estimated", { cents: 20000n }),
    ],
  });
  assert.equal(r.result.cNom, 35000n);
  assert.equal(r.result.cCons, -15000n);
  assert.equal(r.state, "DEPENDE_DE_DADOS");
  assert.equal(r.shown, null);
  assert.deepEqual(
    r.needed.map((g) => g.key),
    ["grande"],
  );
});

test("staleness 4 dias x 50 -> gap stale:saldo com impacto 200", () => {
  // Saldo lido há 4 dias, taxa 50/dia. Gera fluxo stale:saldo em today:
  // nom 0 / cons 200 em today. Como é a única saída antes/no mínimo, o
  // impacto (cCons com cons trocado por nom) = 200.
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 100000n,
    cushion: 0n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    staleness: { days: 4, dailyRate: 50n },
    flows: [],
  });
  const stale = r.gaps.find((g) => g.key === "stale:saldo");
  assert.ok(stale, "gap stale:saldo ausente");
  assert.equal(stale.impact, 200n);
  assert.equal(stale.quality, "stale");
  assert.equal(r.state, "COM_RESSALVA");
  assert.equal(r.shown, 99800n);
});

test("staleness days 0 não gera gap", () => {
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 100000n,
    cushion: 0n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    staleness: { days: 0, dailyRate: 50n },
    flows: [],
  });
  assert.equal(r.gaps.length, 0);
  assert.equal(r.state, "CONFIRMADO");
});

test("unbounded -> INDETERMINADO, shown null, entra em gaps", () => {
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 100000n,
    cushion: 0n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [{ key: "fatura:revisao", reason: "Em revisão, sem total." }],
    flows: [out("conta", "2026-11-15", 10000n, "planned")],
  });
  assert.equal(r.state, "INDETERMINADO");
  assert.equal(r.shown, null);
  const g = r.gaps.find((x) => x.key === "fatura:revisao");
  assert.ok(g);
  assert.equal(g.impact, "unbounded");
  assert.equal(g.reason, "Em revisão, sem total.");
});

test("sem regra de recebimento -> INDETERMINADO com income:sem-regra", () => {
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 100000n,
    cushion: 0n,
    hasIncomeRule: false,
    noIncomeDeclared: false,
    unbounded: [],
    flows: [out("conta", "2026-11-15", 10000n, "planned")],
  });
  assert.equal(r.state, "INDETERMINADO");
  assert.equal(r.shown, null);
  assert.ok(r.gaps.some((g) => g.key === "income:sem-regra"));
});

test("noIncomeDeclared true -> não vira unbounded", () => {
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 100000n,
    cushion: 0n,
    hasIncomeRule: false,
    noIncomeDeclared: true,
    unbounded: [],
    flows: [out("conta", "2026-11-15", 10000n, "planned")],
  });
  assert.ok(!r.gaps.some((g) => g.key === "income:sem-regra"));
  assert.notEqual(r.state, "INDETERMINADO");
  assert.equal(r.state, "CONFIRMADO");
});

test("salário atrasado: entrada inconsistent (nom today com valor, cons 0) tem impacto positivo", () => {
  // Entrada atrasada em today: nom 30000 / cons 0 em today. Trocar cons pelo
  // nom adiciona 30000 ao saldo inicial -> levanta o mínimo em 30000.
  const r = assessConfidence({
    today: "2026-11-09",
    horizonEnd: "2026-11-20",
    sConf: 50000n,
    cushion: 0n,
    hasIncomeRule: true,
    noIncomeDeclared: false,
    unbounded: [],
    flows: [
      income("salario-atrasado", "2026-11-09", 30000n, "inconsistent", {
        cents: 0n,
      }),
      out("aluguel", "2026-11-15", 40000n, "planned"),
    ],
  });
  // base cCons: 50000 - 40000 = 10000 (entrada atrasada contribui cons 0).
  assert.equal(r.result.cCons, 10000n);
  const g = r.gaps.find((x) => x.key === "salario-atrasado");
  assert.ok(g);
  assert.equal(g.impact, 30000n);
  assert.equal(r.state, "COM_RESSALVA");
  assert.equal(r.shown, 10000n);
});

test("embaralhar os fluxos dá o mesmo resultado e não muta o input", () => {
  const base = fixtureF(undefined, markedQuality);
  const shuffled: ConfidenceInput = {
    ...base,
    flows: [...base.flows].reverse(),
  };
  const originalFirst = base.flows[0];
  const a = assessConfidence(base);
  const b = assessConfidence(shuffled);
  assert.equal(b.state, a.state);
  assert.equal(b.shown, a.shown);
  assert.deepEqual(
    b.gaps.map((g) => [g.key, g.impact]),
    a.gaps.map((g) => [g.key, g.impact]),
  );
  // Input intacto.
  assert.equal(base.flows[0], originalFirst);
  assert.equal(base.flows.length, 13);
});
