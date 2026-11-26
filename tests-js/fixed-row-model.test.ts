import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createdNotice,
  isAlreadyInSeries,
  rowAction,
  valuesFromForm,
} from "../app/fixed/fixed-row-model.ts";
import { ApiError } from "../app/lib/api.ts";

const shape = (id: string, kind: string | null, amount: string, review: boolean) => ({
  id,
  kind,
  amount,
  review,
});

test("qual ação a linha oferece", () => {
  assert.equal(rowAction(shape("event:1", "expense", "-100", false)), "form");
  assert.equal(rowAction(shape("event:1", "card_purchase", "-100", false)), "form");
  assert.equal(rowAction(shape("event:1", "income", "100", false)), null);
  assert.equal(rowAction(shape("event:1", "transfer", "-100", false)), null);
  assert.equal(rowAction(shape("bankpending:1", null, "-100", true)), "pending");
  assert.equal(rowAction(shape("bank:1", null, "-100", true)), "pending");
  assert.equal(rowAction(shape("bankpending:1", "income", "100", false)), null);
});

test("saída do banco: confirmada vira conta fixa registrando; agendada só espera", () => {
  const bank = { bankVersion: 3 };
  assert.equal(rowAction({ ...shape("bankpending:1", "expense", "-100", false), ...bank }), "record");
  assert.equal(
    rowAction({ ...shape("bankpending:1", "expense", "-100", false), ...bank, scheduled: true }),
    "confirming",
  );
  assert.equal(
    rowAction({ ...shape("bankpending:1", "expense", "-100", false), ...bank, blocked: true }),
    "confirming",
  );
  // Sem cartão e sem tipo (ex.: transferência) não é registrada por aqui.
  assert.equal(rowAction({ ...shape("bankpending:2", null, "-100", false), ...bank }), "confirming");
  // Compra de cartão do banco: registra como compra e vira conta fixa.
  assert.equal(
    rowAction({ ...shape("bankpending:3", null, "-100", false), ...bank, cardLabel: "Nubank" }),
    "record",
  );
  // Sem versão da leitura não há como registrar.
  assert.equal(rowAction(shape("bankpending:1", "expense", "-100", false)), "confirming");
});

test("já ser conta fixa vem do erro tipado com recurrence_id", () => {
  const body = { error: "x", recurrence_id: "abc" };
  assert.equal(isAlreadyInSeries(new ApiError("x", 400, body)), true);
  assert.equal(isAlreadyInSeries(new ApiError("x", 400, { error: "x" })), false);
  assert.equal(isAlreadyInSeries(new Error("Essa transação já faz parte de uma conta fixa.")), false);
  assert.equal(isAlreadyInSeries("texto"), false);
  assert.equal(new ApiError("msg", 400, body) instanceof Error, true);
});

test("aviso de sucesso muda quando a transação não entrou como a primeira", () => {
  const linked = createdNotice({ recurrence_id: "r", created: 3, source_linked: true }, "10/12");
  assert.equal(linked.tone, "ok");
  assert.match(linked.body, /Próximas: 10\/12\./);
  const loose = createdNotice({ recurrence_id: "r", created: 2, source_linked: false }, "");
  assert.equal(loose.tone, "warn");
  assert.match(loose.body, /não entrou como a primeira/);
});

test("lê os campos do formulário e ignora valores inesperados", () => {
  assert.deepEqual(
    valuesFromForm({
      label: "Netflix",
      frequency: "custom",
      every: "3",
      unit: "week",
      amount: "55,90",
      start_date: "2026-11-10",
      category_id: "abc",
    }),
    {
      label: "Netflix",
      frequency: "custom",
      every: "3",
      unit: "week",
      amount: "55,90",
      startDate: "2026-11-10",
      categoryId: "abc",
      since: "",
      endDate: "",
    },
  );
  const fallback = valuesFromForm({ frequency: "x", unit: 3 });
  assert.deepEqual([fallback.frequency, fallback.unit, fallback.label], ["month", "month", ""]);
});
