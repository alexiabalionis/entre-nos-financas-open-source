import { test } from "node:test";
import assert from "node:assert/strict";
import { openingReading, pickCategories, UNCATEGORIZED, type OpeningBuy } from "../src/domain/opening.ts";

const CLOSED = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const buy = (date: string, category: string, cents: number, rotulo = "Loja", over: Partial<OpeningBuy> = {}): OpeningBuy => ({
  date,
  category,
  cents: BigInt(cents),
  rotulo,
  place: rotulo,
  fixedLike: false,
  ...over,
});
/** Gasto mensal igual em cada um dos meses dados. */
const monthly = (category: string, cents: number, months: readonly string[]) => months.map((m) => buy(`${m}-10`, category, cents));

test("pickCategories: 3 de maior total, mais 2 de maior alta que não estão entre elas; nunca 'Sem categoria'", () => {
  const last3 = CLOSED.slice(-3);
  const buys = [
    ...monthly("A", 900, CLOSED),
    ...monthly("B", 800, CLOSED),
    ...monthly("C", 700, CLOSED),
    ...monthly("D", 400, last3),
    ...monthly("E", 300, last3),
    ...monthly("F", 50, CLOSED),
    ...monthly(UNCATEGORIZED, 5000, CLOSED),
  ];
  assert.deepEqual(pickCategories(buys, CLOSED), ["A", "B", "C", "D", "E"]);
});

test("pickCategories: sem alta, só as de maior total; a de maior alta já no topo não repete", () => {
  const flat = [...monthly("A", 500, CLOSED), ...monthly("B", 400, CLOSED), ...monthly("C", 300, CLOSED), ...monthly("D", 200, CLOSED)];
  assert.deepEqual(pickCategories(flat, CLOSED), ["A", "B", "C"]);
  const rising = [...monthly("A", 500, CLOSED.slice(-3)), ...monthly("B", 100, CLOSED)];
  const picked = pickCategories(rising, CLOSED);
  assert.deepEqual(picked, ["A", "B"]);
});

test("openingReading: 3 maiores compras, lugar só com 3 ou mais, fixa e parcela fora, mês atual dentro do período", () => {
  const closed = CLOSED.slice(-3);
  const buys: OpeningBuy[] = [
    buy("2026-08-03", "Mercado", 1000, "Feira"),
    buy("2026-09-03", "Mercado", 3000, "Feira"),
    buy("2026-10-03", "Mercado", 2000, "Feira"),
    buy("2026-10-04", "Mercado", 500, "Padaria"),
    buy("2026-10-05", "Mercado", 600, "Padaria"),
    buy("2026-10-06", "Mercado", 9000, "Assinatura", { fixedLike: true }),
    buy("2026-11-02", "Mercado", 4000, "Feira"),
    buy("2026-05-02", "Mercado", 700, "Fora do período"),
  ];
  const [m] = openingReading({ buys, closed, current: "2026-11" });
  assert.equal(m!.total_periodo, 1000n + 3000n + 2000n + 500n + 600n + 9000n + 4000n);
  assert.deepEqual(m!.maiores_compras.map((b) => b.cents), [4000n, 3000n, 2000n]);
  assert.deepEqual(m!.lugares_que_se_repetem, [{ rotulo: "Feira", vezes: 4, total: 10000n }]);
  assert.equal(m!.media_3_fechados, 5367n);
});

test("openingReading: compras sem lugar não formam grupo e no máximo 3 lugares", () => {
  const closed = CLOSED.slice(-3);
  const buys: OpeningBuy[] = [];
  for (const [i, name] of ["L1", "L2", "L3", "L4"].entries()) for (let n = 0; n < 3; n++) buys.push(buy(`2026-10-0${n + 1}`, "Lazer", 100 * (i + 1), name));
  for (let n = 0; n < 4; n++) buys.push(buy(`2026-10-1${n}`, "Lazer", 5000, "Sem lugar", { place: null }));
  const [lazer] = openingReading({ buys, closed, current: "2026-11" });
  assert.deepEqual(lazer!.lugares_que_se_repetem.map((p) => p.rotulo), ["L4", "L3", "L2"]);
});
