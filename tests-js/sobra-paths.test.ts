import { test } from "node:test";
import assert from "node:assert/strict";
import { sobraPaths, type CategoryMonth } from "../src/domain/sobra-paths.ts";

const R = (reais: number) => BigInt(reais) * 100n;
// Seis meses fechados: entra R$ 10.000, sai R$ 9.600 → sobra R$ 400 (4%).
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month) => ({
  month,
  in: R(10000),
  out: R(9600),
}));
const cat = (name: string, values: number[]): CategoryMonth[] =>
  values.map((v, i) => ({ month: months[i].month, name, cents: R(v) }));
// Pet: normal 600, últimos 3 em 900 → média 750, folga 150.
// Delivery: 200,200,200,650,650,650 → média 425, recente 650, folga 225.
// Mercado: estável, sem folga.
const categories = [
  ...cat("Pet", [600, 600, 600, 900, 900, 900]),
  ...cat("Delivery", [200, 200, 200, 650, 650, 650]),
  ...cat("Mercado", [1500, 1500, 1500, 1500, 1500, 1500]),
];

test("sobra atual e alvo em %", () => {
  const r = sobraPaths({ months, categories, protectedNames: new Set(), currentMonth: "2026-11", target: { pct: 6 } })!;
  assert.equal(r.kept, R(400));
  assert.equal(r.pct, 4);
  assert.equal(r.target.kept, R(600));
  assert.equal(r.gap, R(200));
});

test("caminho: voltar ao normal das categorias acima da média, até cobrir o alvo", () => {
  const r = sobraPaths({ months, categories, protectedNames: new Set(), currentMonth: "2026-11", target: { pct: 6 } })!;
  assert.deepEqual(
    r.steps.map((s) => [s.name, s.cut, s.kept, s.pct]),
    [["Delivery", R(225), R(625), 6.2]],
    "a maior folga primeiro; para quando cobre o alvo",
  );
  const more = sobraPaths({ months, categories, protectedNames: new Set(), currentMonth: "2026-11", target: { pct: 7 } })!;
  assert.deepEqual(more.steps.map((s) => [s.name, s.kept]), [["Delivery", R(625)], ["Pet", R(775)]]);
  assert.equal(r.missing, 0n);
});

test("categoria protegida fica fora dos cortes e volta à parte; o que falta não é inventado", () => {
  const r = sobraPaths({ months, categories, protectedNames: new Set(["Pet"]), currentMonth: "2026-11", target: { pct: 8 } })!;
  assert.deepEqual(r.steps.map((s) => s.name), ["Delivery"]);
  assert.equal(r.missing, R(800) - R(625));
  assert.deepEqual(r.protectedAbove, [{ name: "Pet", usual: R(750), recent: R(900) }]);
});

test("alvo já atingido: sem passos; mês corrente e sem histórico", () => {
  const r = sobraPaths({ months, categories, protectedNames: new Set(), currentMonth: "2026-11", target: { cents: R(300) } })!;
  assert.equal(r.gap, 0n);
  assert.deepEqual(r.steps, []);
  assert.equal(sobraPaths({ months, categories, protectedNames: new Set(), currentMonth: "2026-05", target: { pct: 5 } }), null);
});

test("acima do normal: lista tudo, sem alvo, do maior excesso para o menor; protegidas à parte", async () => {
  const { aboveUsual } = await import("../src/domain/sobra-paths.ts");
  const r = aboveUsual({ months, categories, protectedNames: new Set(["Pet"]), currentMonth: "2026-11" })!;
  assert.equal(r.kept, R(400));
  assert.deepEqual(r.above.map((a) => [a.name, a.excess]), [["Delivery", R(225)]]);
  assert.deepEqual(r.protectedAbove, [{ name: "Pet", usual: R(750), recent: R(900) }]);
  // Sem proteção, Pet entra também, depois do Delivery (excesso menor).
  const all = aboveUsual({ months, categories, protectedNames: new Set(), currentMonth: "2026-11" })!;
  assert.deepEqual(all.above.map((a) => a.name), ["Delivery", "Pet"]);
  // O alvo de 8% já batido não esconde nada aqui (era o caso do Delivery no eval).
  assert.equal(
    sobraPaths({ months, categories, protectedNames: new Set(), currentMonth: "2026-11", target: { pct: 1 } })!.steps.length,
    0,
  );
});
