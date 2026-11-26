import { test } from "node:test";
import assert from "node:assert/strict";
import { isPairedKind, movementBody } from "../app/dialogs/movement-payload.ts";

test("gasto sai (negativo) e mantém a categoria escolhida", () => {
  const body = movementBody(
    { description: "Passeio", amount: "50,00", category_id: "cat-1" },
    "expense",
    "",
    undefined,
  );
  assert.equal(body?.amount, "-50,00");
  assert.equal(body?.category_id, "cat-1");
  assert.equal(body?.counter_account_id, null);
  assert.equal(body?.related_event_id, null);
});

test("entrada, resgate e rendimento entram (positivo)", () => {
  for (const kind of ["income", "investment_sell", "yield"]) {
    const body = movementBody({ amount: "10,00" }, kind, "acc", undefined);
    assert.equal(body?.amount, "10,00", kind);
  }
});

test("tipos pareados zeram a categoria e levam a conta de destino", () => {
  const body = movementBody(
    { amount: "100,00", category_id: "cat-1" },
    "transfer",
    "acc-2",
    "BRL",
  );
  assert.equal(isPairedKind("transfer"), true);
  assert.equal(body?.category_id, null);
  assert.equal(body?.counter_account_id, "acc-2");
  assert.equal(body?.counter_currency, null);
});

test("câmbio leva a moeda e o valor recebido da contrapartida", () => {
  const body = movementBody(
    { amount: "100,00", counter_amount: "20,00" },
    "fx",
    "acc-2",
    "USD",
  );
  assert.equal(body?.counter_currency, "USD");
  assert.equal(body?.counter_amount, "20,00");
});

test("categoria vazia vira null e valor inválido devolve null", () => {
  assert.equal(
    movementBody({ amount: "5,00", category_id: "" }, "expense", "", undefined)
      ?.category_id,
    null,
  );
  assert.equal(movementBody({ amount: "abc" }, "expense", "", undefined), null);
  assert.equal(isPairedKind("expense"), false);
});
