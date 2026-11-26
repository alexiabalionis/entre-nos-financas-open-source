import { test } from "node:test";
import assert from "node:assert/strict";
import { counterAccounts, kindsFor, missingField, otherSide } from "../src/domain/movement-kind.ts";

test("tipos oferecidos seguem a conta e o sinal", () => {
  assert.deepEqual(kindsFor("card", -100n), ["card_purchase"]);
  assert.deepEqual(kindsFor("card", 100n), ["refund"]);
  assert.deepEqual(kindsFor("checking", -100n), ["expense", "transfer", "card_payment"]);
  assert.deepEqual(kindsFor("checking", 100n), ["income", "transfer"]);
});

test("outra conta: fatura só com cartão, entre contas sem cartão nem investimento", () => {
  const accounts = [
    { id: "c", kind: "checking" },
    { id: "r", kind: "checking" },
    { id: "k", kind: "card" },
    { id: "i", kind: "investment" },
  ];
  assert.deepEqual(counterAccounts(accounts, "c", "card_payment").map((a) => a.id), ["k"]);
  assert.deepEqual(counterAccounts(accounts, "c", "transfer").map((a) => a.id), ["r"]);
});

test("campo que falta antes de salvar", () => {
  const base = { counterAccountId: null, relatedEventId: null, categoryId: null };
  assert.equal(missingField({ ...base, kind: "transfer" }), "counter");
  assert.equal(missingField({ ...base, kind: "refund" }), "related");
  assert.equal(missingField({ ...base, kind: "expense" }), "category");
  assert.equal(missingField({ ...base, kind: "transfer", counterAccountId: "r" }), null);
  assert.equal(missingField({ ...base, kind: "refund", relatedEventId: "e" }), null);
});

test("outra ponta só quando há exatamente uma, de valor oposto e até 3 dias", () => {
  const row = (id: string, accountId: string, date: string, cents: bigint) => ({ id, accountId, date, cents });
  const pending = [row("a", "k", "2026-10-21", 30000n), row("b", "k", "2026-10-30", 30000n), row("c", "x", "2026-10-20", 30000n)];
  assert.equal(otherSide(pending, "k", "2026-10-20", -30000n), "a");
  assert.equal(otherSide([...pending, row("d", "k", "2026-10-19", 30000n)], "k", "2026-10-20", -30000n), null);
  assert.equal(otherSide(pending, "k", "2026-10-20", -1n), null);
});
