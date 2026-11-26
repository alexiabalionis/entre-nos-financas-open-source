import { test } from "node:test";
import assert from "node:assert/strict";
import { editFrom, seriesChanges, seriesEditErrors, seriesEditValues } from "../app/fixed/series-edit-model.ts";

const item = (frequency: "day" | "week" | "month" | "year", every: number) => ({
  label: "Votorantim",
  planned_cents: "18990",
  category_id: "cat-1",
  recurrence: { frequency, every, occurrence_date: "2026-11-10" },
});

test("valores iniciais vêm da conta deste mês", () => {
  assert.deepEqual(seriesEditValues(item("month", 1)), {
    label: "Votorantim",
    frequency: "month",
    every: "1",
    unit: "month",
    amount: "189,90",
    startDate: "2026-11-10",
    categoryId: "cat-1",
    endDate: "",
  });
  const two = seriesEditValues(item("month", 2));
  assert.deepEqual([two.frequency, two.every, two.unit], ["custom", "2", "month"]);
  const daily = seriesEditValues(item("day", 1));
  assert.deepEqual([daily.frequency, daily.unit], ["custom", "day"]);
  const biennial = seriesEditValues(item("year", 2));
  assert.deepEqual([biennial.frequency, biennial.every, biennial.unit], ["custom", "24", "month"]);
});

test("data antes desta conta: a edição passa a valer dela; o fim é opcional", () => {
  const base = seriesEditValues(item("month", 1));
  assert.equal(seriesEditErrors({ ...base, startDate: "2026-11-01" }, "2026-11-10").startDate, undefined);
  const earlier = seriesChanges({ ...base, startDate: "2026-11-01" }, "2026-11-10");
  assert.equal(earlier?.start_date, "2026-11-01");
  assert.equal(editFrom(earlier, "2026-11-10"), "2026-11-01");
  assert.equal(editFrom({ start_date: "2026-11-20" }, "2026-11-10"), "2026-11-10");
  assert.deepEqual(seriesChanges({ ...base, label: "Votorantim energia", amount: "200,00" }, "2026-11-10"), {
    label: "Votorantim energia",
    expected_cents: 20000,
    frequency: "month",
    every: 1,
    start_date: "2026-11-10",
    category_id: "cat-1",
    end_date: null,
  });
  assert.equal(seriesChanges({ ...base, endDate: "2027-06-30" }, "2026-11-10")?.end_date, "2027-06-30");
  assert.ok(seriesEditErrors({ ...base, endDate: "2026-10-01" }, "2026-11-10").endDate);
});

test("série com fim: o campo mostra o fim e apagar tira o fim", () => {
  const ending = { ...item("month", 1), recurrence: { ...item("month", 1).recurrence, end_date: "2026-11-26" } };
  const base = seriesEditValues(ending);
  assert.equal(base.endDate, "2026-11-26");
  assert.equal(seriesChanges(base, "2026-11-10")?.end_date, "2026-11-26");
  assert.equal(seriesChanges({ ...base, endDate: "" }, "2026-11-10")?.end_date, null);
});
