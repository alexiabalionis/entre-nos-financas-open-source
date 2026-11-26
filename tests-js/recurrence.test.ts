import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverage,
  expectedDate,
  isFixedBill,
  isManuallyEdited,
  isRecurring,
  nthOccurrence,
  occurrencesBetween,
  planningMonth,
  type RecurrenceRule,
} from "../src/domain/recurrence.ts";
import { fifthBusinessDay, incomeDate } from "../src/domain/bank-analysis.ts";

const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  frequency: "month",
  every: 1,
  startDate: "2027-01-31",
  endDate: null,
  dateRule: "exact",
  planningOffset: 0,
  ...over,
});

test("mensal dia 31 volta ao dia 31 sem grudar no 28", () => {
  assert.deepEqual(occurrencesBetween(rule({}), "2027-01-01", "2027-05-31"), [
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
    "2027-04-30",
    "2027-05-31",
  ]);
});

test("bissexto: mensal em fevereiro de 2028 e anual em 29/02", () => {
  assert.equal(nthOccurrence(rule({ startDate: "2028-01-31" }), 1), "2028-02-29");
  const yearly = rule({ frequency: "year", startDate: "2028-02-29" });
  assert.deepEqual(occurrencesBetween(yearly, "2028-01-01", "2032-12-31"), [
    "2028-02-29",
    "2029-02-28",
    "2030-02-28",
    "2031-02-28",
    "2032-02-29",
  ]);
});

test("a cada N: duas semanas cruzando mês e ano", () => {
  const r = rule({ frequency: "week", every: 2, startDate: "2026-12-17" });
  assert.deepEqual(occurrencesBetween(r, "2026-12-01", "2027-01-31"), [
    "2026-12-17",
    "2026-12-31",
    "2027-01-14",
    "2027-01-28",
  ]);
});

test("a cada N meses ancora no start", () => {
  const q = rule({ every: 3, startDate: "2026-11-15" });
  assert.deepEqual(occurrencesBetween(q, "2026-11-16", "2027-12-31").slice(0, 3), [
    "2027-02-15",
    "2027-05-15",
    "2027-08-15",
  ]);
  const b = rule({ every: 2, startDate: "2027-12-31" });
  assert.deepEqual(occurrencesBetween(b, "2027-12-01", "2028-04-30"), [
    "2027-12-31",
    "2028-02-29",
    "2028-04-30",
  ]);
});

test("semanal com 4 e 5 ocorrências no mês; diária a cada 1 e 3 dias", () => {
  const w = rule({ frequency: "week", startDate: "2027-02-03" });
  assert.equal(occurrencesBetween(w, "2027-02-01", "2027-02-28").length, 4);
  assert.equal(occurrencesBetween(w, "2027-03-01", "2027-03-31").length, 5);
  const d1 = rule({ frequency: "day", startDate: "2027-02-26" });
  assert.deepEqual(occurrencesBetween(d1, "2027-02-27", "2027-03-02"), [
    "2027-02-27",
    "2027-02-28",
    "2027-03-01",
    "2027-03-02",
  ]);
  const d3 = rule({ frequency: "day", every: 3, startDate: "2027-02-26" });
  assert.deepEqual(occurrencesBetween(d3, "2027-02-27", "2027-03-10"), [
    "2027-03-01",
    "2027-03-04",
    "2027-03-07",
    "2027-03-10",
  ]);
});

test("âncora estável: 12ª direta igual à geração; date_rule não muda a data teórica", () => {
  const r = rule({ startDate: "2027-01-31" });
  assert.equal(nthOccurrence(r, 11), occurrencesBetween(r, "2027-01-01", "2030-01-01")[11]);
  const shifted = rule({ dateRule: "weekend_to_friday" });
  assert.deepEqual(
    occurrencesBetween(shifted, "2027-01-01", "2028-12-31"),
    occurrencesBetween(r, "2027-01-01", "2028-12-31"),
  );
});

test("limites: start no meio do mês, end inclusivo, nada fora do intervalo", () => {
  const r = rule({ startDate: "2027-01-15", endDate: "2027-04-15" });
  const all = occurrencesBetween(r, "2026-01-01", "2030-01-01");
  assert.deepEqual(all, ["2027-01-15", "2027-02-15", "2027-03-15", "2027-04-15"]);
  assert.deepEqual(occurrencesBetween(r, "2027-02-16", "2027-04-14"), ["2027-03-15"]);
  assert.deepEqual(occurrencesBetween(r, "2027-05-01", "2027-06-01"), []);
});

test("expectedDate: weekend_to_friday equivale a incomeDate (dias 1..28, 24 meses)", () => {
  for (let i = 0; i < 24; i++) {
    const month = new Date(Date.UTC(2026, i, 1)).toISOString().slice(0, 7);
    for (let day = 1; day <= 28; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      assert.equal(
        expectedDate(rule({ dateRule: "weekend_to_friday" }), date),
        incomeDate(month, day),
      );
    }
    assert.equal(
      expectedDate(rule({ dateRule: "fifth_business_day" }), `${month}-10`),
      fifthBusinessDay(month),
    );
  }
  assert.equal(expectedDate(rule({}), "2027-02-28"), "2027-02-28");
});

test("planningMonth: offset 0 e 1, dezembro vira janeiro", () => {
  assert.equal(planningMonth(rule({}), "2026-10-23"), "2026-10");
  assert.equal(planningMonth(rule({ planningOffset: 1 }), "2026-10-23"), "2026-11");
  assert.equal(planningMonth(rule({ planningOffset: 1 }), "2026-12-24"), "2027-01");
});

test("entradas inválidas lançam erro", () => {
  assert.throws(() => nthOccurrence(rule({ every: 0 }), 1));
  assert.throws(() => nthOccurrence(rule({ startDate: "2027-02-30" }), 1));
  assert.throws(() => occurrencesBetween(rule({}), "x", "2027-01-01"));
});

test("coverage: completa só se todas as datas têm linha", () => {
  assert.equal(coverage(["2027-01-01", "2027-01-08"], new Set(["2027-01-01", "2027-01-08", "x"])), "complete");
  assert.equal(coverage(["2027-01-01", "2027-01-08"], new Set(["2027-01-01"])), "pending");
  assert.equal(coverage([], new Set()), "complete");
});

test("isManuallyEdited: cada campo diverge", () => {
  const base = { planned_cents: "100", label: "Aluguel", category_id: "c1", due_date: "2027-01-05", month: "2027-01" };
  assert.equal(isManuallyEdited({ ...base }, base), false);
  assert.equal(isManuallyEdited({ ...base, planned_cents: "200" }, base), true);
  assert.equal(isManuallyEdited({ ...base, label: "Outro" }, base), true);
  assert.equal(isManuallyEdited({ ...base, category_id: null }, base), true);
  assert.equal(isManuallyEdited({ ...base, due_date: null }, base), true);
  assert.equal(isManuallyEdited({ ...base, month: "2027-02" }, base), true);
});

test("isRecurring / isFixedBill: entrada recorrente não é conta fixa", () => {
  assert.equal(isRecurring({ recurrence_id: "r1" }), true);
  assert.equal(isRecurring({ recurrence_id: null }), false);
  assert.equal(isRecurring({}), false);
  assert.equal(isFixedBill({ recurrence_id: "r1", purpose: "expense" }), true);
  assert.equal(isFixedBill({ recurrence_id: "r1", purpose: "income" }), false);
  assert.equal(isFixedBill({ recurrence_id: null, purpose: "expense" }), false);
});
