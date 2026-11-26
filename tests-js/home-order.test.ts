import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHomeOrder,
  homeCards,
  defaultPreferences,
} from "../src/domain/preferences.ts";

// Ordem legada real (anterior à Etapa 3): 9 ids, dos quais "categories" e
// "summary" foram retirados de homeCards na Etapa 4 (o topo fixo e o card
// "composition" os substituem na tela Mês). normalizeHomeOrder trata os dois
// como qualquer id desconhecido: descarta, sem preservar posição.
const oldOrder = [
  "categories",
  "summary",
  "receipts",
  "alerts",
  "cards",
  "income",
  "fixed",
  "variable",
  "saving",
];
// O que sobra de oldOrder depois de descartar os 2 ids retirados, na mesma
// ordem relativa.
const survivingOldOrder = [
  "receipts",
  "alerts",
  "cards",
  "income",
  "fixed",
  "variable",
  "saving",
];
const newIds = ["upcoming", "pending", "path", "composition"];

test("normalizeHomeOrder drops the 2 retired ids (categories/summary) from a legacy 9-id order and appends the 4 new month-block ids, preserving the relative order of what remains", () => {
  const { card_order } = normalizeHomeOrder(oldOrder, []);
  assert.equal(card_order.length, homeCards.length);
  assert.deepEqual(card_order.slice(0, survivingOldOrder.length), survivingOldOrder);
  assert.deepEqual(card_order.slice(survivingOldOrder.length), newIds);
});

test("normalizeHomeOrder keeps a custom legacy order (e.g. alerts first) and still appends new ids at the end", () => {
  const custom = ["alerts", "categories", "summary", "receipts", "cards", "income", "fixed", "variable", "saving"];
  const survivingCustom = ["alerts", "receipts", "cards", "income", "fixed", "variable", "saving"];
  const { card_order } = normalizeHomeOrder(custom, []);
  assert.deepEqual(card_order.slice(0, survivingCustom.length), survivingCustom);
  assert.deepEqual(card_order.slice(survivingCustom.length), newIds);
});

test("normalizeHomeOrder discards unknown ids", () => {
  const { card_order } = normalizeHomeOrder(["categories", "ghost-block", ...oldOrder.slice(1)], []);
  assert.ok(!card_order.includes("ghost-block" as never));
  assert.equal(card_order.length, homeCards.length);
});

test("normalizeHomeOrder removes duplicates, keeping the first occurrence", () => {
  const { card_order } = normalizeHomeOrder(["receipts", "receipts", ...oldOrder.slice(1)], []);
  assert.equal(card_order.filter((id) => id === "receipts").length, 1);
  assert.equal(card_order.length, homeCards.length);
});

test("normalizeHomeOrder filters hidden_cards to known ids, without duplicates", () => {
  const { hidden_cards } = normalizeHomeOrder(oldOrder, [
    "cards",
    "cards",
    "ghost-block",
    "fixed",
  ]);
  assert.deepEqual(hidden_cards, ["cards", "fixed"]);
});

test("normalizeHomeOrder is idempotent", () => {
  const first = normalizeHomeOrder(oldOrder, ["cards", "ghost"]);
  const second = normalizeHomeOrder(first.card_order, first.hidden_cards);
  assert.deepEqual(second.card_order, first.card_order);
  assert.deepEqual(second.hidden_cards, first.hidden_cards);
  // Applying it to the already-complete default order/hidden set is also a no-op.
  const onDefault = normalizeHomeOrder(
    defaultPreferences.card_order,
    defaultPreferences.hidden_cards,
  );
  assert.deepEqual(onDefault.card_order, defaultPreferences.card_order);
  assert.deepEqual(onDefault.hidden_cards, defaultPreferences.hidden_cards);
});
