import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixedOrigin,
  fixedPayload,
  nextDates,
  nextText,
  validateFixed,
  type FixedFormValues,
} from "../app/fixed/fixed-form-model.ts";

const row = {
  id: "event:3f2b1c9e-7f2e-4f0e-9d3e-0a1b2c3d4e5f",
  description: "Netflix",
  account: "Nubank · conta",
  date: "2026-11-10",
  category: "Assinaturas",
  amount: "-5590",
};
const categories = [
  { id: "7d1c9a52-0000-4000-8000-000000000001", name: "Moradia" },
  { id: "7d1c9a52-0000-4000-8000-000000000002", name: "Assinaturas" },
];
const origin = fixedOrigin(row, categories);
const values = (over: Partial<FixedFormValues> = {}): FixedFormValues => ({
  ...origin.values,
  ...over,
});

test("preenche o formulário com o que veio do movimento", () => {
  assert.equal(origin.eventId, "3f2b1c9e-7f2e-4f0e-9d3e-0a1b2c3d4e5f");
  assert.deepEqual(origin.values, {
    label: "Netflix",
    frequency: "month",
    every: "2",
    unit: "month",
    amount: "55,90",
    startDate: "2026-11-10",
    categoryId: categories[1].id,
  });
  assert.equal(fixedOrigin({ ...row, category: null }, categories).values.categoryId, "");
});

test("payload mensal leva valor em centavos, categoria e início", () => {
  assert.deepEqual(fixedPayload(values(), origin), {
    event_id: origin.eventId,
    frequency: "month",
    every: 1,
    start_date: "2026-11-10",
    expected_cents: 5590,
    label: "Netflix",
    category_id: categories[1].id,
  });
});

test("payload omite categoria vazia e só envia confirm quando confirmado", () => {
  const plain = fixedPayload(values({ categoryId: "" }), origin);
  assert.ok(plain && !("category_id" in plain) && !("confirm" in plain));
  assert.equal(fixedPayload(values(), origin, true)?.confirm, true);
});

test("frequências: semanal, anual e personalizada", () => {
  assert.deepEqual(
    [fixedPayload(values({ frequency: "week" }), origin)].map((p) => [p?.frequency, p?.every]),
    [["week", 1]],
  );
  assert.equal(fixedPayload(values({ frequency: "year" }), origin)?.frequency, "year");
  const custom = fixedPayload(values({ frequency: "custom", every: "15", unit: "day" }), origin);
  assert.deepEqual([custom?.frequency, custom?.every], ["day", 15]);
  const monthly = fixedPayload(values({ frequency: "custom", every: "2", unit: "month" }), origin);
  assert.deepEqual([monthly?.frequency, monthly?.every], ["month", 2]);
});

test("próximas 3 datas, depois da transação de origem", () => {
  assert.deepEqual(nextDates(values(), origin), ["2026-12-10", "2027-01-10", "2027-02-10"]);
  assert.deepEqual(nextDates(values({ frequency: "week" }), origin), [
    "2026-11-17",
    "2026-11-24",
    "2026-12-01",
  ]);
  assert.deepEqual(nextDates(values({ frequency: "year" }), origin), [
    "2027-11-10",
    "2028-11-10",
    "2029-11-10",
  ]);
  assert.deepEqual(
    nextDates(values({ frequency: "custom", every: "2", unit: "month" }), origin),
    ["2027-01-10", "2027-03-10", "2027-05-10"],
  );
  assert.deepEqual(
    nextDates(values({ frequency: "custom", every: "10", unit: "day" }), origin),
    ["2026-11-20", "2026-11-30", "2026-12-10"],
  );
});

test("início em outro dia: a primeira data é o próprio início", () => {
  assert.deepEqual(nextDates(values({ startDate: "2026-12-05" }), origin), [
    "2026-12-05",
    "2027-01-05",
    "2027-02-05",
  ]);
});

test("dia 31 cai no último dia de cada mês e volta ao 31", () => {
  const day31 = fixedOrigin({ ...row, date: "2026-12-31" }, categories);
  assert.deepEqual(nextDates(day31.values, day31), ["2027-01-31", "2027-02-28", "2027-03-31"]);
  const jan31 = fixedOrigin({ ...row, date: "2027-01-31" }, categories);
  assert.deepEqual(nextDates(jan31.values, jan31), ["2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("texto das próximas: dia/mês, e com ano na frequência anual", () => {
  assert.equal(nextText(values(), origin), "10/12, 10/01, 10/02");
  assert.equal(nextText(values({ frequency: "year" }), origin), "10/11/2027, 10/11/2028, 10/11/2029");
  assert.equal(nextText(values({ startDate: "" }), origin), "");
});

test("valor: vazio, zero, sem centavos e negativo são recusados", () => {
  for (const amount of ["", "0,00", "55", "abc", "-5,00", "5,5"]) {
    assert.ok(validateFixed(values({ amount }), origin).amount, amount);
    assert.equal(fixedPayload(values({ amount }), origin), null, amount);
  }
  for (const amount of ["55,90", "1.234,56", "0,01"])
    assert.equal(validateFixed(values({ amount }), origin).amount, undefined, amount);
});

test("início não pode ser antes da data da transação", () => {
  assert.ok(validateFixed(values({ startDate: "2026-11-09" }), origin).startDate);
  assert.equal(validateFixed(values({ startDate: "2026-11-10" }), origin).startDate, undefined);
  assert.equal(validateFixed(values({ startDate: "2026-11-11" }), origin).startDate, undefined);
  assert.ok(validateFixed(values({ startDate: "" }), origin).startDate);
  assert.ok(validateFixed(values({ startDate: "2026-02-31" }), origin).startDate);
  assert.equal(fixedPayload(values({ startDate: "2026-11-09" }), origin), null);
});

test("nome e repetição personalizada são validados", () => {
  assert.ok(validateFixed(values({ label: "   " }), origin).label);
  assert.ok(validateFixed(values({ label: "x".repeat(181) }), origin).label);
  for (const every of ["", "0", "1.5", "367", "abc"])
    assert.ok(
      validateFixed(values({ frequency: "custom", every }), origin).every,
      every,
    );
  assert.equal(validateFixed(values({ every: "0" }), origin).every, undefined);
});

test("desde e termina em: opcionais, validados e enviados só quando preenchidos", () => {
  assert.equal(validateFixed(values({ since: "", endDate: "" }), origin).since, undefined);
  assert.equal(validateFixed(values({ since: "2026-08" }), origin).since, undefined);
  assert.ok(validateFixed(values({ since: "2026-12" }), origin).since);
  assert.ok(validateFixed(values({ since: "agosto" }), origin).since);
  assert.ok(validateFixed(values({ endDate: "2026-11-01" }), origin).endDate);
  assert.equal(validateFixed(values({ endDate: "2027-03-31" }), origin).endDate, undefined);
  const payload = fixedPayload(values({ since: "2026-08", endDate: "2027-03-31" }), origin);
  assert.equal(payload?.since_month, "2026-08");
  assert.equal(payload?.end_date, "2027-03-31");
  const plain = fixedPayload(values({ since: "2026-11", endDate: "" }), origin);
  assert.equal(plain?.since_month, undefined);
  assert.equal(plain?.end_date, undefined);
});
