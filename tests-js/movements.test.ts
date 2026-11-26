import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bankMovement,
  movementTitle,
  movementTotals,
  visibleMovements,
  type Movement,
} from "../src/domain/movements.ts";
const row = (
  id: string,
  kind: string | null,
  amount: string,
  extra: Partial<Movement> = {},
): Movement => ({
  id,
  kind,
  amount,
  date: "2026-10-24",
  description: "Mercado São João",
  account: "Nubank",
  category: "Alimentação",
  review: false,
  duplicate: false,
  ...extra,
});
test("movement totals exclude previews, internal transfers and invoice payments; purchases counted only once", () => {
  const totals = movementTotals([
    row("1", "income", "100000"),
    row("2", "expense", "-3000"),
    row("3", "card_purchase", "-2000"),
    row("4", "card_payment", "-2000"),
    row("5", "transfer", "-40000"),
    row("6", "refund", "500"),
    row("7", null, "900000", { review: true }),
    row("8", "expense", "-99999", { review: true }),
  ]);
  assert.deepEqual(totals, {
    income: "100000",
    expense: "4500",
    transfers: 1,
    review: 2,
  });
});
test("movement search matches account, category and accent-insensitive words; review never classified from sign", () => {
  const rows = [
    row("older", "expense", "-1", { date: "2026-10-01" }),
    row("newer", null, "500", { review: true }),
    row("itau", "income", "400", { account: "Itaú", date: "2026-10-25" }),
  ];
  assert.equal(
    visibleMovements(rows, { query: "itau", filter: "income" })[0].id,
    "itau",
  );
  assert.equal(
    visibleMovements(rows, {
      query: "alimentacao sao",
      filter: "review",
      account: "Nubank",
    })[0].id,
    "newer",
  );
  assert.equal(
    visibleMovements(rows, { query: "", filter: "income", account: "Nubank" })
      .length,
    0,
  );
  assert.deepEqual(
    visibleMovements(
      [...rows, row("saude", "expense", "-5", { category: "Saúde" })],
      { query: "", filter: "all", category: "Saúde" },
    ).map((r) => r.id),
    ["saude"],
  );
  assert.deepEqual(
    visibleMovements(rows, { query: "", filter: "all" }).map((r) => r.id),
    ["itau", "newer", "older"],
  );
});
test("filtro Fixas: movimentos ligados a conta fixa, de qualquer grupo", () => {
  const rows = [
    row("aluguel", "expense", "-290000", { fixed: true }),
    row("carro", "card_purchase", "-140000", { fixed: true }),
    row("mercado", "expense", "-30000"),
    row("sem", "expense", "-1000", { category: null }),
  ];
  assert.deepEqual(
    visibleMovements(rows, { query: "", filter: "fixed" })
      .map((r) => r.id)
      .sort(),
    ["aluguel", "carro"],
  );
});

test("bank rows never wait for approval: they count by sign, own transfers and investments are neutral, repeats join the existing entry", () => {
  const bank = (group: string | null, amount: string, extra = {}) => ({
    id: "b",
    version: 1,
    transaction_date: "2026-11-10",
    description: "LOJA",
    amount_cents: amount,
    account_name: "Itau",
    account_kind: "checking",
    group,
    autospend: false,
    scheduled: false,
    suggested_category: "Mercado",
    tag_id: null,
    tag_name: null,
    ...extra,
  });
  const rows = [
    bankMovement(bank("expense", "-1000")),
    bankMovement(bank("income", "5000")),
    bankMovement(bank("pending", "-300")),
    bankMovement(bank("transfer", "-2000")),
    bankMovement(bank("investment", "-4000")),
    bankMovement(bank("card", "-7000")),
  ].map((r) => r!);
  assert.ok(rows.every((r) => !r.review));
  assert.deepEqual(
    rows.map((r) => r.kind),
    ["expense", "income", "expense", "transfer", "investment_buy", "card_payment"],
  );
  const totals = movementTotals(rows);
  assert.equal(totals.expense, "1300");
  assert.equal(totals.income, "5000");
  assert.equal(totals.review, 0);
  assert.equal(bankMovement(bank("duplicate", "-1000")), null);
  assert.equal(bankMovement(bank("history", "-1000")), null);
  const card = bankMovement(bank("expense", "-900", { account_kind: "card" }))!;
  assert.equal(card.kind, null);
  assert.equal(card.cardLabel, "Itau");
});
test("search matches the nickname of a movement", () => {
  const rows = [
    row("a", "expense", "-100", { name: "Feira da semana" }),
    row("b", "expense", "-100", { description: "Padaria" }),
  ];
  assert.deepEqual(
    visibleMovements(rows, { query: "feira", filter: "all" }).map((r) => r.id),
    ["a"],
  );
});
test("movementTitle uses the nickname and falls back to the description", () => {
  assert.equal(movementTitle({ description: "PIX MERC" }), "PIX MERC");
  assert.equal(
    movementTitle({ description: "PIX MERC", name: "Mercado" }),
    "Mercado",
  );
  assert.equal(
    movementTitle({ description: "PIX MERC", name: "   " }),
    "PIX MERC",
  );
});
test("tag filter is exact and rows without a tag never match it", () => {
  const rows = [
    row("a", "expense", "-100", { tag: "Feira" }),
    row("b", "expense", "-100", { tag: "Padaria" }),
    row("c", "expense", "-100"),
    row("d", "expense", "-100", { tag: null }),
  ];
  const ids = (tag: string) =>
    visibleMovements(rows, { query: "", filter: "all", tag })
      .map((r) => r.id)
      .sort();
  assert.deepEqual(ids("Feira"), ["a"]);
  assert.deepEqual(ids("Fei"), []);
  assert.deepEqual(ids(""), ["a", "b", "c", "d"]);
});
test("search matches the tag name, accent-insensitive", () => {
  const rows = [
    row("a", "expense", "-100", { tag: "Padaria do Zé" }),
    row("b", "expense", "-100", { tag: null }),
  ];
  assert.deepEqual(
    visibleMovements(rows, { query: "padaria ze", filter: "all" }).map(
      (r) => r.id,
    ),
    ["a"],
  );
});

test("promptLabel: apelido; Pix e transferência sem nome de pessoa; números longos somem", async () => {
  const { promptLabel } = await import("../src/domain/movements.ts");
  const m = (description: string, amount: string, kind: string | null = "expense", displayName?: string) => ({
    description,
    amount,
    kind,
    displayName,
  });
  assert.equal(promptLabel(m("IFOOD *RESTAURANTE", "-5000", "expense", "Jantar")), "Jantar");
  assert.equal(promptLabel(m("PIX ENVIADO MARIA DA SILVA 123.456.789-00", "-10000")), "Pix enviado");
  assert.equal(promptLabel(m("Pix recebido João Souza", "10000", "income")), "Pix recebido");
  assert.equal(promptLabel(m("TED JOSE PEREIRA", "-10000")), "Transferência enviada");
  assert.equal(promptLabel(m("Conta própria", "-10000", "transfer")), "Transferência enviada");
  assert.equal(promptLabel(m("IFOOD *RESTAURANTE", "-5000")), "Ifood *restaurante");
  assert.equal(promptLabel(m("COMPRA CNPJ 12345678000190 LOJA", "-5000")), "Compra Cnpj … Loja");
});

test("movementRows: eventos, importados a conferir e banco pendente, como na tela", async () => {
  const { movementRows } = await import("../src/domain/movements.ts");
  const rows = movementRows({
    events: [
      {
        id: "e1",
        transaction_date: "2026-11-02",
        description: "Mercado",
        account_name: "Corrente",
        category_name: "Mercado",
        tag_name: null,
        amount_cents: "-1000",
        kind: "expense",
        fixed: false,
      },
    ],
    bankRows: [
      {
        id: "s1",
        recorded: true,
        transaction_date: "2026-11-02",
        description: "já salvo",
        account_name: "Corrente",
        category_name: null,
        amount_cents: "-1000",
        event_kind: "expense",
        duplicate_hint: false,
      },
      {
        id: "s2",
        recorded: false,
        transaction_date: "2026-11-03",
        description: "a conferir",
        account_name: "Corrente",
        category_name: null,
        amount_cents: "-500",
        event_kind: null,
        duplicate_hint: false,
      },
    ],
    bankPending: [],
  });
  assert.deepEqual(rows.map((r) => [r.id, r.review]), [["event:e1", false], ["bank:s2", true]]);
});
