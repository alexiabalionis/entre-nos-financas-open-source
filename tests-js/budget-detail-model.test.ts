import { test } from "node:test";
import assert from "node:assert/strict";
import {
  budgetDetail,
  diffLabel,
  type DetailInput,
} from "../app/budgets/budget-detail-model.ts";
import type { MonthItem } from "../app/hooks/use-month-data.ts";

const fmt = (c: bigint) => `R$${c / 100n},${String(c % 100n).padStart(2, "0")}`;

const item = (over: Partial<MonthItem>): MonthItem =>
  ({
    id: "i1",
    label: "Estacionamento mensal",
    purpose: "expense",
    currency: "BRL",
    category_id: "c1",
    planned_cents: "15000",
    paid_cents: null,
    event_id: null,
    derived: false,
    due_date: null,
    recurrence: null,
    ...over,
  }) as MonthItem;

const event = (over: Record<string, unknown>) => ({
  id: "e1",
  kind: "expense",
  transaction_date: "2026-11-05",
  description: "ESTAPAR",
  amount_cents: "-16500",
  currency: "BRL",
  account_id: "a1",
  category_id: "c1",
  ...over,
});

function detail(over: Partial<DetailInput>) {
  return budgetDetail({
    categoryId: "c1",
    currency: "BRL",
    spent: 0n,
    events: [],
    lines: [],
    accounts: [{ id: "a1", kind: "checking" }],
    items: [],
    fmt,
    ...over,
  } as DetailInput);
}

test("conta conciliada de R$150 paga R$165 conta 165 uma vez, com +R$15", () => {
  const d = detail({
    spent: 16500n,
    events: [event({}) as never],
    items: [item({ event_id: "e1", paid_cents: "16500", status: "done" })],
  });
  assert.equal(d.spentRows.length, 1);
  assert.equal(d.spentRows[0].cents, 16500n);
  assert.equal(d.spentRows[0].diff, 1500n);
  assert.equal(diffLabel(1500n, fmt), "+R$15,00");
  assert.equal(d.upcomingRows.length, 0);
  assert.equal(d.upcomingTotal, 0n);
  assert.match(d.note?.body ?? "", /previsto em R\$150,00 e foi pago por R\$165,00/);
});

test("a pagar: só o que falta, sem derivado, sem conciliado e sem outra categoria", () => {
  const d = detail({
    items: [
      item({ id: "a", label: "Condomínio", planned_cents: "61200", due_date: "2026-11-15" }),
      item({ id: "b", label: "Parcial", planned_cents: "10000", paid_cents: "4000" }),
      item({ id: "c", derived: true }),
      item({ id: "d", event_id: "x" }),
      item({ id: "e", category_id: "outra" }),
      item({ id: "f", purpose: "income" }),
      item({ id: "g", paid_cents: "15000" }),
    ],
  });
  assert.deepEqual(d.upcomingRows.map((r) => [r.key, r.cents]), [["a", 61200n], ["b", 6000n]]);
  assert.equal(d.upcomingRows[0].sub, "Vence em 15/11/2026");
  assert.equal(d.upcomingTotal, 67200n);
});

test("compra de cartão fora da lista de eventos fecha a conta numa linha à parte", () => {
  const d = detail({
    spent: 30000n,
    accounts: [
      { id: "a1", kind: "checking" },
      { id: "k1", kind: "card" },
    ],
    events: [
      event({ amount_cents: "-10000" }) as never,
      event({ id: "e2", account_id: "k1", amount_cents: "-99900" }) as never,
      event({ id: "e3", category_id: "outra" }) as never,
      event({ id: "e4", kind: "transfer" }) as never,
    ],
  });
  assert.deepEqual(d.spentRows.map((r) => r.cents), [10000n, 20000n]);
  assert.equal(d.spentRows[1].key, "outros");
});

test("cada compra de cartão, pendente e débito automático vira uma linha própria", () => {
  const line = (over: Record<string, unknown>) =>
    ({
      category_id: "c1",
      source: "card",
      description: "KIRO",
      account_name: "Nubank",
      transaction_date: "2026-10-20",
      amount_cents: "5000",
      ...over,
    }) as never;
  const d = detail({
    spent: 30000n,
    events: [event({ amount_cents: "-10000" }) as never],
    lines: [
      line({}),
      line({ source: "card_pending", description: "WELLHUB", amount_cents: "12000" }),
      line({ source: "auto", description: "ENEL", account_name: "Itaú", amount_cents: "3000" }),
      line({ category_id: "outra", amount_cents: "99900" }),
    ],
  });
  assert.deepEqual(
    d.spentRows.map((r) => [r.title, r.cents]),
    [
      ["ESTAPAR", 10000n],
      ["KIRO", 5000n],
      ["WELLHUB", 12000n],
      ["ENEL", 3000n],
    ],
  );
  assert.equal(d.spentRows[1].sub, "Cartão · Nubank · 20/10/2026");
  assert.equal(d.spentRows[2].sub, "Cartão, ainda pendente no banco · Nubank · 20/10/2026");
  assert.ok(!d.spentRows.some((r) => r.key === "outros"));
});

test("Pix agendado no banco aparece em ainda vai pagar, não em já gastou", () => {
  const d = detail({
    spent: 0n,
    lines: [
      {
        category_id: "c1",
        source: "scheduled",
        description: "Pix agendado Paula Exemplo Garcia",
        account_name: "Conta Corrente",
        transaction_date: "2026-12-01",
        amount_cents: "45000",
      },
    ],
  });
  assert.equal(d.spentRows.length, 0);
  assert.deepEqual(
    d.upcomingRows.map((r) => [r.title, r.cents, r.sub]),
    [["Pix agendado Paula Exemplo Garcia", 45000n, "Agendado · Conta Corrente · sai em 01/12/2026"]],
  );
  assert.equal(d.upcomingTotal, 45000n);
});
