import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverName,
  pickCover,
  type CoverLine,
  type OpenSeriesItem,
} from "../src/server/fixed-bank-cover.ts";

const item = (over: Partial<OpenSeriesItem>): OpenSeriesItem => ({
  id: "i1",
  month: "2026-11-01",
  planned_cents: "114521",
  category_id: "c1",
  expected_date: "2026-11-01",
  account_id: "card1",
  card: true,
  frequency: "month",
  match_text: null,
  label: "KIRO POWERSEATTLEUSA",
  ...over,
});

const line = (over: Partial<CoverLine>): CoverLine => ({
  id: "t1",
  source: "card",
  description: "KIRO POWERSEATTLEUSA",
  cents: "120303",
  transaction_date: "2026-11-01",
  account_id: "card1",
  month: "2026-11",
  ...over,
});

test("nome da conta fixa sai da primeira palavra sem o tipo da operação", () => {
  assert.equal(coverName(null, "KIRO POWERSEATTLEUSA"), "KIRO");
  assert.equal(coverName(null, "Pix enviado MARIA EXEMPLO DA SILVA"), "MARIA");
  assert.equal(coverName(null, "Academia Exemplo Pessoa Sao PauloBRA"), "ACADEMIA");
});

test("compra na fatura do mês cobre a conta fixa do cartão, mesmo com valor 5% maior", () => {
  assert.equal(pickCover(item({}), [line({})], new Set())?.id, "t1");
});

test("compra de outra fatura, outro cartão ou outro nome não cobre", () => {
  const used = new Set<string>();
  assert.equal(pickCover(item({}), [line({ month: "2026-12" })], used), null);
  assert.equal(pickCover(item({}), [line({ account_id: "card2" })], used), null);
  assert.equal(pickCover(item({}), [line({ description: "GOOGLE ONE" })], used), null);
  assert.equal(pickCover(item({}), [line({ cents: "200000" })], used), null);
});

test("Pix agendado cobre a conta fixa da conta corrente; outro Pix de mesmo valor não", () => {
  const fixed = item({
    label: "Pix enviado JOAO EXEMPLO SILVA SOUZA",
    planned_cents: "40000",
    expected_date: "2026-11-25",
    account_id: "cc",
    card: false,
  });
  const lines = [
    line({ id: "v", source: "checking", account_id: "cc", description: "Pix enviado Carla Exemplo", cents: "40000", transaction_date: "2026-11-24" }),
    line({ id: "f", source: "checking", account_id: "cc", description: "Pix agendado JOAO EXEMPLO S SOUZA", cents: "40000", transaction_date: "2026-11-25" }),
  ];
  assert.equal(pickCover(fixed, lines, new Set())?.id, "f");
});

test("semanal não pega o pagamento da semana vizinha e cada linha cobre uma vez", () => {
  const weekly = item({
    label: "Pix enviado LUCIA EXEMPLO DOS SANTOS",
    planned_cents: "23000",
    expected_date: "2026-11-15",
    account_id: "cc",
    card: false,
    frequency: "week",
  });
  const paid = line({ id: "p", source: "checking", account_id: "cc", description: "Pix enviado LUCIA EXEMPLO DOS SANTOS", cents: "23000", transaction_date: "2026-11-08" });
  assert.equal(pickCover(weekly, [paid], new Set()), null);
  const near = { ...paid, transaction_date: "2026-11-15" };
  assert.equal(pickCover(weekly, [near], new Set(["p"])), null);
  assert.equal(pickCover(weekly, [near], new Set())?.id, "p");
});

test("conta fixa coberta pelo banco não soma em 'ainda vai pagar'", async () => {
  const { openPlannedCents } = await import("../src/domain/budget.ts");
  const base = { purpose: "expense", planned_cents: "40000", paid_cents: null, archived: false, derived: false, event_id: null };
  assert.equal(openPlannedCents([base]), 40000n);
  assert.equal(openPlannedCents([{ ...base, bank_cover: { cents: "40000" } }]), 0n);
});

test("status da conta fixa coberta: na fatura ou no banco, com o valor do banco", async () => {
  const { fixedState, fixedSubtitle, shownCents } = await import("../app/fixed/fixed-status.ts");
  const base = { status: "open", event_id: null, paid_cents: null, planned_cents: "40000", due_date: "2026-11-25", candidates: [], currency: "BRL" };
  const cover = { bank_transaction_id: "t", source: "checking" as const, description: "Pix agendado", transaction_date: "2026-11-25", cents: "40000" };
  assert.equal(fixedState({ ...base, bank_cover: cover }), "bank");
  assert.equal(fixedSubtitle({ ...base, bank_cover: cover }, "2026-11-16"), "Agendado no banco para 25/11/2026");
  const card = { ...cover, source: "card" as const, transaction_date: "2026-11-01", cents: "120303" };
  assert.equal(fixedState({ ...base, bank_cover: card }), "card");
  assert.equal(shownCents({ ...base, bank_cover: card }), "120303");
});

test("sem o nome na descrição, só o valor exato no dia do vencimento cobre", () => {
  const lesson = item({
    label: "Aulas de espanhol",
    planned_cents: "45000",
    expected_date: "2026-12-01",
    account_id: "cc",
    card: false,
  });
  const pix = line({ id: "val", source: "checking", account_id: "cc", description: "Pix agendado Paula Exemplo Garcia", cents: "45000", transaction_date: "2026-12-01" });
  assert.equal(pickCover(lesson, [pix], new Set())?.id, "val");
  assert.equal(pickCover(lesson, [{ ...pix, transaction_date: "2026-12-02" }], new Set()), null);
  assert.equal(pickCover(lesson, [{ ...pix, cents: "45100" }], new Set()), null);
  assert.equal(pickCover(lesson, [pix], new Set(["val"])), null);
});
