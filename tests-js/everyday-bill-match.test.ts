import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchProbablePayments,
  withinTolerance,
  type OpenBill,
  type SpendCandidate,
} from "../src/domain/everyday-bill-match.ts";

const bill = (o: Partial<OpenBill> = {}): OpenBill => ({
  id: "b1", month: "2026-11", category: "Mercado", remaining: 10000n, due: "2026-11-12", ...o,
});
const spend = (key: string, cents: bigint, date = "2026-11-05", category: string | null = "Mercado"): SpendCandidate => ({
  key, date, category, cents,
});

test("withinTolerance: ±20% do previsto, bordas incluídas", () => {
  assert.equal(withinTolerance(12000n, 10000n), true);
  assert.equal(withinTolerance(8000n, 10000n), true);
  assert.equal(withinTolerance(12001n, 10000n), false);
  assert.equal(withinTolerance(7999n, 10000n), false);
});

test("pagamento provável: só o gasto da mesma categoria, mês e faixa", () => {
  const taken = matchProbablePayments([bill()], [
    spend("a", 9800n),
    spend("b", 7000n),
    spend("c", 9800n, "2026-10-30"),
    spend("d", 9800n, "2026-11-05", "Outra"),
    spend("e", 9800n, "2026-11-05", null),
  ]);
  assert.deepEqual([...taken], ["a"]);
});

test("pagamento provável: um gasto por conta; vence o valor mais próximo, depois a data", () => {
  assert.deepEqual([...matchProbablePayments([bill()], [spend("a", 9800n), spend("b", 10100n)])], ["b"]);
  assert.deepEqual(
    [...matchProbablePayments([bill()], [spend("a", 9800n, "2026-11-01"), spend("b", 9800n, "2026-11-11")])],
    ["b"],
  );
});

test("pagamento provável: duas contas não absorvem o mesmo gasto; sem restante não absorve", () => {
  const taken = matchProbablePayments(
    [bill({ id: "b1" }), bill({ id: "b2" }), bill({ id: "b3", remaining: 0n })],
    [spend("a", 9900n), spend("b", 10000n), spend("c", 10000n)],
  );
  assert.equal(taken.size, 2);
});
