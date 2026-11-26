import { test } from "node:test";
import assert from "node:assert/strict";
import {
  frequencyDescription,
  nextLabel,
  occurrenceTitle,
  reviewDetail,
  reviewSummary,
} from "../app/fixed/overview/overview-copy.ts";
import {
  canConvert,
  formDefaults,
  mergeFormValues,
  suggestionStartDate,
  validateSeriesForm,
} from "../app/fixed/overview/overview-form-model.ts";
import {
  dismissRequest,
  formRequest,
  reviewRequest,
} from "../app/fixed/overview/overview-requests.ts";
import {
  editableItemIds,
  frequentGroup,
  groupSeries,
  isEditable,
  isEmptyOverview,
  occurrenceChips,
  sectionOf,
  seriesPhase,
  seriesRow,
  summary,
} from "../app/fixed/overview/overview-model.ts";
import type {
  Overview,
  OverviewLegacy,
  OverviewOccurrence,
  OverviewReview,
  OverviewSeries,
  OverviewSuggestion,
} from "../app/fixed/overview/overview-types.ts";

const occurrence = (patch: Partial<OverviewOccurrence> = {}): OverviewOccurrence => ({
  item_id: "i1",
  version: 1,
  occurrence_date: "2026-11-05",
  due_date: "2026-11-05",
  planned_cents: "240000",
  paid_cents: null,
  status: "open",
  event_id: null,
  archived: false,
  ...patch,
});

const series = (patch: Partial<OverviewSeries> = {}): OverviewSeries => ({
  id: "s1",
  card: null,
  next_item: null,
  label: "Aluguel",
  frequency: "month",
  every: 1,
  start_date: "2026-01-05",
  end_date: null,
  paused: false,
  expected_cents: "240000",
  next_date: "2026-12-05",
  month_cents: "240000",
  occurrences: [occurrence()],
  ...patch,
});

const suggestion = (patch: Partial<OverviewSuggestion> = {}): OverviewSuggestion => ({
  scope: "cash",
  merchant_key: "cpfl energia",
  label: "CPFL Energia",
  account: "Nubank",
  cents: "-18877",
  day: 4,
  months: 5,
  category: "Moradia",
  category_id: "c1",
  account_id: "a1",
  decision: null,
  previously_confirmed: false,
  installments: null,
  ...patch,
});

const legacy = (patch: Partial<OverviewLegacy> = {}): OverviewLegacy => ({
  item_id: "L1",
  version: 3,
  label: "Seguro do carro",
  planned_cents: "21000",
  due_date: "2026-11-20",
  category_id: "c2",
  status: "open",
  ...patch,
});

test("fase da série segue a regra do servidor", () => {
  const today = "2026-11-11";
  assert.equal(seriesPhase(series(), today), "active");
  assert.equal(seriesPhase(series({ paused: true }), today), "paused");
  assert.equal(seriesPhase(series({ end_date: "2026-11-10" }), today), "ended");
  assert.equal(seriesPhase(series({ end_date: "2026-11-11" }), today), "active");
  assert.equal(seriesPhase(series({ start_date: "2026-12-07", end_date: "2026-12-06" }), today), "ended");
});

test("diária e semanal são agrupadas; sem ocorrência vai para outros meses", () => {
  const daily = series({ id: "d", frequency: "day" });
  const weekly = series({ id: "w", frequency: "week" });
  const yearly = series({ id: "y", frequency: "year", occurrences: [] });
  const late = series({ id: "late", occurrences: [occurrence({ occurrence_date: "2026-11-25" })] });
  const early = series({ id: "early", occurrences: [occurrence({ occurrence_date: "2026-11-03" })] });
  assert.equal(sectionOf(daily), "frequent");
  assert.equal(sectionOf(weekly), "frequent");
  assert.equal(sectionOf(yearly), "other");
  const groups = groupSeries([late, daily, yearly, early, weekly]);
  assert.deepEqual(groups.monthly.map((s) => s.id), ["early", "late"]);
  assert.deepEqual(groups.frequent.map((s) => s.id), ["d", "w"]);
  assert.deepEqual(groups.other.map((s) => s.id), ["y"]);
});

test("texto da frequência", () => {
  const base = { start_date: "2026-01-05", every: 1 };
  assert.equal(frequencyDescription({ ...base, frequency: "month" }), "Todo mês, dia 5");
  assert.equal(frequencyDescription({ ...base, frequency: "day" }), "Todo dia");
  assert.equal(frequencyDescription({ ...base, frequency: "year" }), "Todo ano, 05/01");
  assert.equal(frequencyDescription({ ...base, start_date: "2026-11-06", frequency: "week" }), "Toda sexta");
  assert.equal(frequencyDescription({ ...base, start_date: "2026-11-07", frequency: "week" }), "Todo sábado");
  assert.equal(frequencyDescription({ ...base, every: 2, frequency: "month" }), "A cada 2 meses");
  assert.equal(occurrenceTitle("2026-11-11"), "Qua 11/11");
  assert.equal(nextLabel({ frequency: "month", next_date: "2026-12-05" }), "próxima 05/12");
  assert.equal(nextLabel({ frequency: "year", next_date: "2027-01-05" }), "próxima 05/01/2027");
  assert.equal(nextLabel({ frequency: "month", next_date: null }), "sem próxima data");
});

test("linha da série mostra situação, diferença de valor, pausa e pulo", () => {
  const today = "2026-11-11";
  const planned = seriesRow(series(), today, false);
  assert.equal(planned.sub, "Todo mês, dia 5 · próxima 05/12");
  const onCard = seriesRow(series({ card: { name: "Nubank", next_month: "2026-12", next_due_date: "2026-12-26" } }), today, false);
  assert.equal(onCard.sub, "Todo mês, dia 5 · próxima 05/12 · no Nubank · entra na fatura de dezembro, vence 26/12");
  assert.deepEqual(planned.chips.map((c) => c.label), ["Previsto"]);

  const paidMore = occurrence({ status: "done", planned_cents: "8500", paid_cents: "10000" });
  const chips = occurrenceChips(paidMore, false).map((c) => c.label);
  assert.equal(chips[0], "Pago");
  assert.match(chips[1], /a mais/);
  assert.equal(seriesRow(series({ occurrences: [paidMore] }), today, false).cents, "10000");

  const reconciled = occurrence({ status: "done", paid_cents: "240000", event_id: "e1" });
  assert.equal(occurrenceChips(reconciled, false)[0].label, "Conciliado com o banco");

  const skipped = series({ occurrences: [occurrence({ archived: true })] });
  assert.deepEqual(seriesRow(skipped, today, false).chips.map((c) => c.label), ["Pulada neste mês"]);

  const paused = seriesRow(series({ paused: true }), today, false);
  assert.deepEqual(paused.chips.map((c) => c.label), ["Pausada", "Previsto"]);
  const ended = seriesRow(series({ end_date: "2026-10-01" }), today, false);
  assert.equal(ended.chips[0].label, "Encerrada");
});

test("grupo de várias vezes conta só as ocorrências ativas", () => {
  const group = frequentGroup(
    series({
      frequency: "week",
      start_date: "2026-11-06",
      month_cents: "48000",
      occurrences: [occurrence({ item_id: "a" }), occurrence({ item_id: "b" }), occurrence({ item_id: "c", archived: true })],
    }),
    "2026-11-11",
  );
  assert.equal(group.sub, "Toda sexta · 2 neste mês");
  assert.equal(group.totalCents, "48000");
  assert.equal(group.occurrences.length, 3);
});

test("resumo e visão vazia", () => {
  assert.deepEqual(summary({ total_cents: "100", active: 1 }, "2026-11"), {
    eyebrow: "Total das contas fixas em novembro",
    totalCents: "100",
    caption: "1 conta fixa ativa",
  });
  assert.equal(summary({ total_cents: "0", active: 7 }, "2026-11").caption, "7 contas fixas ativas");
  const empty: Overview = { total_cents: "0", active: 0, series: [], suggestions: [], legacy: [], card_cycle_review: [] };
  assert.equal(isEmptyOverview(empty), true);
  assert.equal(isEmptyOverview({ ...empty, legacy: [legacy()] }), false);
});

test("só edita ocorrência que o Mês conhece como conta fixa", () => {
  const items = [
    { id: "i1", purpose: "expense", recurrence: { id: "s1" } },
    { id: "i2", purpose: "expense", recurrence: null },
  ] as unknown as Parameters<typeof editableItemIds>[0];
  const editable = editableItemIds(items);
  assert.deepEqual([...editable], ["i1"]);
  assert.equal(isEditable(occurrence({ item_id: "i1" }), editable), true);
  assert.equal(isEditable(occurrence({ item_id: "i2" }), editable), false);
  assert.equal(isEditable(occurrence({ item_id: "i1", archived: true }), editable), false);
});

test("início da sugestão: o dia deste mês se ainda não passou, senão o do próximo", () => {
  assert.equal(suggestionStartDate(16, "2026-11-11"), "2026-11-16");
  assert.equal(suggestionStartDate(11, "2026-11-11"), "2026-11-11");
  assert.equal(suggestionStartDate(4, "2026-11-11"), "2026-12-04");
  assert.equal(suggestionStartDate(31, "2026-11-11"), "2026-11-30");
  assert.equal(suggestionStartDate(31, "2026-12-31"), "2026-12-31");
  assert.equal(suggestionStartDate(30, "2026-01-31"), "2026-02-28");
});

test("sugestão vira corpo de recurrences/create com a chave do comerciante", () => {
  const target = { kind: "suggestion", suggestion: suggestion() } as const;
  const { mode, values, minDate } = formDefaults(target, "2026-11-11", "2026-11");
  assert.equal(mode, "create");
  assert.equal(minDate, "2026-11-11");
  assert.equal(values.amount, "188,77");
  assert.equal(values.startDate, "2026-12-04");
  assert.equal(values.categoryId, "c1");
  assert.deepEqual(formRequest(target, values, minDate), {
    route: "recurrences/create",
    body: {
      purpose: "expense",
      label: "CPFL Energia",
      expected_cents: 18877,
      category_id: "c1",
      account_id: "a1",
      frequency: "month",
      every: 1,
      start_date: "2026-12-04",
      match_text: "cpfl energia",
    },
  });
  const noCategory = formDefaults({ kind: "suggestion", suggestion: suggestion({ category_id: null, account_id: null }) }, "2026-11-11", "2026-11");
  const body = formRequest({ kind: "suggestion", suggestion: suggestion({ category_id: null, account_id: null }) }, noCategory.values, "2026-11-11")?.body;
  assert.equal(body?.category_id, null);
  assert.equal(body?.account_id, null);
});

test("formulário da sugestão recusa nome, valor e data inválidos", () => {
  const { values, minDate } = formDefaults({ kind: "suggestion", suggestion: suggestion() }, "2026-11-11", "2026-11");
  const bad = { ...values, label: " ", amount: "abc", startDate: "2026-11-01" };
  const errors = validateSeriesForm("create", bad, minDate);
  assert.ok(errors.label && errors.amount && errors.startDate);
  assert.equal(errors.startDate, "Escolha uma data a partir de 11/11/2026.");
  assert.equal(formRequest({ kind: "suggestion", suggestion: suggestion() }, bad, minDate), null);
  const every = validateSeriesForm("create", { ...values, frequency: "custom", every: "0" }, minDate);
  assert.ok(every.every);
});

test("item antigo vira corpo de recurrences/convert e ignora nome e valor", () => {
  const target = { kind: "legacy", legacy: legacy() } as const;
  const defaults = formDefaults(target, "2026-11-11", "2026-11");
  assert.equal(defaults.mode, "convert");
  assert.equal(defaults.minDate, "2026-11-20");
  assert.deepEqual(formRequest(target, defaults.values, defaults.minDate), {
    route: "recurrences/convert",
    body: { item_id: "L1", version: 3, frequency: "month", every: 1, start_date: "2026-11-20" },
  });
  const edited = { ...defaults.values, frequency: "custom" as const, every: "3", unit: "week" as const, label: "", amount: "" };
  assert.deepEqual(validateSeriesForm("convert", edited, defaults.minDate), {});
  assert.deepEqual(formRequest(target, edited, defaults.minDate)?.body, {
    item_id: "L1", version: 3, frequency: "week", every: 3, start_date: "2026-11-20",
  });
  const merged = mergeFormValues("convert", defaults.values, edited);
  assert.equal(merged.label, "Seguro do carro");
  assert.equal(merged.every, "3");
  assert.equal(formDefaults({ kind: "legacy", legacy: legacy({ due_date: null }) }, "2026-11-11", "2026-11").minDate, "2026-11-01");
  const early = validateSeriesForm("convert", { ...defaults.values, startDate: "2026-11-01" }, defaults.minDate);
  assert.equal(early.startDate, "Escolha uma data a partir de 20/11/2026.");
});

test("só converte item antigo com valor previsto", () => {
  assert.equal(canConvert(legacy()), true);
  assert.equal(canConvert(legacy({ planned_cents: null })), false);
  assert.equal(canConvert(legacy({ planned_cents: "0" })), false);
});

test("'Não é fixa' manda dismiss com o escopo da sugestão", () => {
  assert.deepEqual(dismissRequest(suggestion({ scope: "card-1" })), {
    route: "recurrences/decision",
    body: { scope: "card-1", merchant_key: "cpfl energia", decision: "dismiss" },
  });
});

test("revisão do cartão move para o mês sugerido; sem vencimento sugerido envia null", () => {
  const review: OverviewReview = {
    item_id: "i9",
    version: 2,
    label: "Nubank",
    current_month: "2026-10",
    suggested_month: "2026-11",
    suggested_due_date: "2026-11-08",
  };
  assert.deepEqual(reviewRequest(review), {
    route: "recurrences/move",
    body: { item_id: "i9", version: 2, month: "2026-11", due_date: "2026-11-08" },
  });
  assert.equal(reviewRequest({ ...review, suggested_due_date: null }).body.due_date, null);
  assert.match(reviewDetail(review), /outubro de 2026.*novembro de 2026.*08\/11\/2026/);
  assert.match(reviewDetail({ ...review, suggested_due_date: null }), /sem vencimento/);
  assert.equal(reviewSummary(1), "1 previsão pode estar no mês errado.");
  assert.equal(reviewSummary(2), "2 previsões podem estar no mês errado.");
});
