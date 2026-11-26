import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountDifference,
  fixedState,
  fixedSubtitle,
  isRealized,
  isSeriesBill,
  shownCents,
  stateBadge,
  type StatusItem,
} from "../app/fixed/fixed-status.ts";

function item(over: Partial<StatusItem>): StatusItem {
  return {
    status: "open",
    event_id: null,
    paid_cents: null,
    planned_cents: "61200",
    due_date: "2026-11-15",
    candidates: [],
    currency: "BRL",
    ...over,
  } as StatusItem;
}

const candidate = { amount_cents: "-13461" } as StatusItem["candidates"][number];

test("estado: previsto, pago, conciliado, aguardando conferência e parcial", () => {
  assert.equal(fixedState(item({})), "planned");
  assert.equal(fixedState(item({ status: "done", paid_cents: "61200" })), "paid");
  assert.equal(fixedState(item({ status: "partial", paid_cents: "100" })), "partial");
  assert.equal(
    fixedState(item({ status: "done", event_id: "e1", paid_cents: "61200" })),
    "reconciled",
  );
  assert.equal(fixedState(item({ candidates: [candidate] })), "awaiting");
  assert.equal(
    fixedState(item({ status: "done", candidates: [candidate] })),
    "paid",
  );
});

test("rótulos e tons dos estados", () => {
  assert.deepEqual(stateBadge("planned"), { tone: "neutral", label: "Previsto", mark: "○" });
  assert.equal(stateBadge("reconciled").label, "Conciliado com o banco");
  assert.equal(stateBadge("awaiting").tone, "warn");
  assert.equal(stateBadge("paid").tone, "ok");
});

test("diferença: água prevista R$ 85,00 e paga R$ 100,00 mostra +R$ 15,00 a mais", () => {
  const water = item({ status: "done", planned_cents: "8500", paid_cents: "10000" });
  assert.deepEqual(amountDifference(water), {
    detail: "Previsto R$ 85,00 · pago R$ 100,00",
    chip: "+R$ 15,00 a mais",
    tone: "warn",
  });
  assert.equal(
    amountDifference(item({ status: "done", planned_cents: "10000", paid_cents: "8500" }))?.chip,
    "R$ 15,00 a menos",
  );
});

test("sem diferença quando o valor bate, não foi pago por inteiro ou falta valor", () => {
  assert.equal(amountDifference(item({ status: "done", paid_cents: "61200" })), null);
  assert.equal(amountDifference(item({ status: "partial", paid_cents: "100" })), null);
  assert.equal(amountDifference(item({})), null);
  assert.equal(amountDifference(item({ status: "done", planned_cents: null, paid_cents: "100" })), null);
});

test("valores escondidos não vazam na diferença", () => {
  const water = item({ status: "done", planned_cents: "8500", paid_cents: "10000" });
  const hidden = amountDifference(water, true)!;
  assert.doesNotMatch(hidden.chip + hidden.detail, /\d/);
});

test("valor mostrado é o pago quando pago ou conciliado, senão o previsto", () => {
  assert.equal(shownCents(item({ status: "done", planned_cents: "8500", paid_cents: "10000" })), "10000");
  assert.equal(shownCents(item({ status: "partial", planned_cents: "8500", paid_cents: "100" })), "8500");
  assert.equal(shownCents(item({})), "61200");
});

test("realizada segue a regra do servidor: status, pagamento ou conciliação", () => {
  assert.equal(isRealized(item({})), false);
  assert.equal(isRealized(item({ candidates: [candidate] })), false);
  assert.equal(isRealized(item({ status: "partial" })), true);
  assert.equal(isRealized(item({ paid_cents: "1" })), true);
  assert.equal(isRealized(item({ event_id: "e" })), true);
});

test("subtítulo da linha", () => {
  assert.equal(fixedSubtitle(item({}), "2026-11-09"), "Vence em 15/11/2026");
  assert.equal(fixedSubtitle(item({}), "2026-11-20"), "Venceu em 15/11/2026");
  assert.equal(fixedSubtitle(item({ status: "done", paid_cents: "61200" }), "2026-11-09"), "Vencia em 15/11/2026");
  assert.equal(fixedSubtitle(item({ due_date: null }), "2026-11-09"), "Sem vencimento");
  assert.equal(
    fixedSubtitle(item({ candidates: [candidate] }), "2026-11-09"),
    "Achamos um movimento de R$ 134,61 no banco. Confira.",
  );
});

test("só despesa de série é conta fixa; entrada de série não é", () => {
  const rec = { id: "r1", frequency: "month", every: 1, start_date: "2026-11-15", end_date: null, occurrence_date: "2026-11-15", card_name: null } as const;
  assert.equal(isSeriesBill({ purpose: "expense", recurrence: rec }), true);
  assert.equal(isSeriesBill({ purpose: "income", recurrence: rec }), false);
  assert.equal(isSeriesBill({ purpose: "expense", recurrence: null }), false);
});
