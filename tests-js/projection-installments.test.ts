import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveInstallments,
  stripInstallmentMarker,
  type InstallmentLine,
} from "../src/domain/projection-installments.ts";
import type { CycleVersion } from "../src/domain/card-competence.ts";

// Ciclo fecha dia 13, vence dia 20, sem offset. Compra 2026-09-02 cai na fatura
// de 2026-09 (fecha 09-13, vence 09-20). Parcela k vence shiftMonth(2026-09,
// k-1): k=3 -> 2026-11, k=4 -> 2026-12, ..., k=10 -> 2027-06.
const C1: CycleVersion = {
  closing_day: 13,
  due_day: 20,
  due_month_offset: 0,
  valid_from: "2026-01-01",
  valid_until: null,
};
const cycles = new Map<string, CycleVersion[]>([["card1", [C1]]]);

function line(
  over: Partial<InstallmentLine> & { id: string },
): InstallmentLine {
  return {
    card: "card1",
    purchaseDate: "2026-09-02",
    transactionDate: "2026-11-02",
    merchant: "LOJA X",
    cents: 6000n,
    k: 3,
    n: 10,
    billDueDate: null,
    ...over,
  };
}

test("3/10 observada deriva 4..10 com vencimentos 2026-12..2027-06", () => {
  const { series, byBill } = deriveInstallments(
    [line({ id: "L1" })],
    cycles,
    "2026-11",
  );
  assert.equal(series.length, 1);
  const s = series[0]!;
  assert.equal(s.quality, "structural");
  assert.deepEqual(s.observed, [3]);
  // k' derivados de 4 a 10, valor base 6000, meses contados a partir da
  // competência da 3ª parcela (2026-11).
  const expectedMonths = [
    "2026-12",
    "2027-01",
    "2027-02",
    "2027-03",
    "2027-04",
    "2027-05",
    "2027-06",
  ];
  assert.deepEqual(
    s.derived.map((d) => [d.k, d.dueMonth, d.cents]),
    expectedMonths.map((m, idx) => [idx + 4, m, 6000n]),
  );
  // byBill soma as derivadas com dueMonth >= 2026-11: uma por mês de 2026-12 em
  // diante.
  assert.equal(byBill.get("card1|2026-12"), 6000n);
  assert.equal(byBill.get("card1|2027-06"), 6000n);
  // 2026-11 é a parcela observada (não derivada): não entra em byBill.
  assert.equal(byBill.get("card1|2026-11"), undefined);
});

test("banco lança a 4/10: a derivada 4 some e 2026-12 não vem de estimativa", () => {
  // Observadas 3 e 4; a derivação começa em 5. A obrigação de 2026-12 passa a
  // ser a parcela REAL (observada), então byBill não traz mais estimativa lá.
  const { series, byBill } = deriveInstallments(
    [line({ id: "L1", k: 3 }), line({ id: "L2", k: 4 })],
    cycles,
    "2026-11",
  );
  assert.equal(series.length, 1);
  const s = series[0]!;
  assert.deepEqual(s.observed, [3, 4]);
  assert.deepEqual(
    s.derived.map((d) => d.k),
    [5, 6, 7, 8, 9, 10],
  );
  // 2026-12 não tem contribuição derivada: a parcela real cobre o mês.
  assert.equal(byBill.get("card1|2026-12"), undefined);
  // 2027-01 (k=5) é a primeira derivada.
  assert.equal(byBill.get("card1|2027-01"), 6000n);
});

test("1ª parcela com o centavo do arredondamento (266,67 e 266,66): uma compra só, sem derivar de novo", () => {
  const { series, byBill } = deriveInstallments(
    [
      line({ id: "A1", k: 1, n: 3, cents: 26667n, purchaseDate: "2026-11-02", transactionDate: "2026-11-02" }),
      line({ id: "A2", k: 2, n: 3, cents: 26666n, purchaseDate: "2026-11-02", transactionDate: "2026-12-16" }),
      line({ id: "A3", k: 3, n: 3, cents: 26666n, purchaseDate: "2026-11-02", transactionDate: "2027-01-16" }),
    ],
    cycles,
    "2026-11",
  );
  assert.equal(series.length, 1);
  assert.deepEqual(series[0]!.observed, [1, 2, 3]);
  assert.equal(series[0]!.derived.length, 0);
  assert.equal(byBill.size, 0);
});

test("duas linhas 3/10 idênticas: 2 séries com keys distintas e byBill dobra", () => {
  const { series, byBill } = deriveInstallments(
    [line({ id: "L1" }), line({ id: "L2" })],
    cycles,
    "2026-11",
  );
  assert.equal(series.length, 2);
  // As cópias idênticas recebem keys ÚNICAS pelo índice 1-based: #1 e #2.
  const keys = new Set(series.map((s) => s.key));
  assert.equal(keys.size, 2);
  const suffixes = series.map((s) => s.key.slice(s.key.lastIndexOf("#")));
  assert.deepEqual([...suffixes].sort(), ["#1", "#2"]);
  // Cada série deriva 7 parcelas de 6000; byBill de cada mês é dobrado.
  assert.equal(byBill.get("card1|2026-12"), 12000n);
  assert.equal(byBill.get("card1|2027-06"), 12000n);
});

test("keys de séries são únicas com duas séries idênticas e uma diferente", () => {
  const { series } = deriveInstallments(
    [
      // Duas 3/10 idênticas (multiplicidade 2 -> cópias #1 e #2).
      line({ id: "L1" }),
      line({ id: "L2" }),
      // Uma série diferente (outra compra/merchant).
      line({ id: "L3", purchaseDate: "2026-09-05", merchant: "LOJA Y" }),
    ],
    cycles,
    "2026-11",
  );
  assert.equal(series.length, 3);
  const keys = new Set(series.map((s) => s.key));
  // Toda key é única: 2 cópias distintas (#1, #2) + a série diferente.
  assert.equal(keys.size, series.length);
});

test("última 10/10 casa quando |cents-base| <= n-1, não casa fora disso", () => {
  // n=10, base 6000; tolerância n-1 = 9. 6007 casa (|7| <= 9), 6020 não (|20| > 9).
  const matches = deriveInstallments(
    [
      line({ id: "A1", k: 3, cents: 6000n }),
      line({ id: "A2", k: 10, cents: 6007n }),
    ],
    cycles,
    "2026-11",
  );
  // Uma só série: a última (6007) anexou à base 6000.
  assert.equal(matches.series.length, 1);
  assert.deepEqual(matches.series[0]!.observed, [3, 10]);

  const noMatch = deriveInstallments(
    [
      line({ id: "B1", k: 3, cents: 6000n }),
      line({ id: "B2", k: 10, cents: 6020n }),
    ],
    cycles,
    "2026-11",
  );
  // Duas séries: a última (6020) virou base própria, não fundiu.
  assert.equal(noMatch.series.length, 2);
});

test("sem data da compra não funde com outra igual e fica estimada", () => {
  const { series } = deriveInstallments(
    [
      line({ id: "N1", purchaseDate: null, k: 3, cents: 6000n }),
      line({ id: "N2", purchaseDate: null, k: 3, cents: 6000n }),
    ],
    cycles,
    "2026-11",
  );
  // Cada linha é sua própria série (ancorada no id), nenhuma derivação.
  assert.equal(series.length, 2);
  for (const s of series) {
    assert.equal(s.quality, "estimated");
    assert.equal(s.derived.length, 0);
  }
  assert.notEqual(series[0]!.key, series[1]!.key);
});

test("parcela 2/3 que atravessa troca de versão de ciclo usa a versão nova", () => {
  // v1 vigente até 2026-11-13; v2 a partir de 2026-11-14 com vencimento dia 12.
  // Compra 2026-10-25 (fatura v1, vence 2026-11-20). A parcela 3/3 cai numa
  // fatura governada pela v2 — a competência vem de cardCompetence, não do v1.
  const v1: CycleVersion = {
    ...C1,
    valid_from: "2026-09-14",
    valid_until: "2026-11-13",
  };
  const v2: CycleVersion = {
    ...C1,
    closing_day: 5,
    due_day: 12,
    valid_from: "2026-11-14",
    valid_until: null,
  };
  const twoVersions = new Map<string, CycleVersion[]>([["card1", [v1, v2]]]);
  const { series } = deriveInstallments(
    [
      line({
        id: "P1",
        purchaseDate: "2026-10-25",
        transactionDate: "2026-11-25",
        k: 2,
        n: 3,
        cents: 5000n,
      }),
    ],
    twoVersions,
    "2026-11",
  );
  assert.equal(series.length, 1);
  const s = series[0]!;
  assert.deepEqual(s.observed, [2]);
  // Observada k=2 -> competência 2026-12 (dueDate 12); derivada 3/3 em 2027-01
  // pela versão nova (vencimento dia 12), via cardCompetence/shiftMonth.
  assert.deepEqual(
    s.derived.map((d) => [d.k, d.dueMonth, d.cents]),
    [[3, "2027-01", 5000n]],
  );
});

test("stripInstallmentMarker tira o marcador colado no nome e preserva o resto", () => {
  assert.equal(stripInstallmentMarker("JIM.COM* ANNA PAUL01/10", 1, 10), "JIM.COM* ANNA PAUL");
  assert.equal(stripInstallmentMarker("LOJA X 02/10", 2, 10), "LOJA X");
  assert.equal(stripInstallmentMarker("LOJA X PARC 3/10", 3, 10), "LOJA X");
  assert.equal(stripInstallmentMarker("Loja X parcela 4 de 10", 4, 10), "Loja X");
  assert.equal(stripInstallmentMarker("LOJA X (05/10)", 5, 10), "LOJA X");
  // Só o marcador que bate com k/n sai; sem marcador, nada muda.
  assert.equal(stripInstallmentMarker("LOJA 2025", 1, 3), "LOJA 2025");
  assert.equal(stripInstallmentMarker("LOJA X 02/10", 3, 10), "LOJA X 02/10");
});

test("parcelas da mesma compra com o marcador no nome viram uma série só", () => {
  const lines = [1, 2, 3].map((k) =>
    line({ id: "P" + k, k, merchant: stripInstallmentMarker(`LOJA X0${k}/10`, k, 10) }),
  );
  const { series } = deriveInstallments(lines, cycles, "2026-09");
  assert.equal(series.length, 1);
  assert.deepEqual(series[0]!.observed, [1, 2, 3]);
  assert.equal(series[0]!.derived.length, 7);
});
