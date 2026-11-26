import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionMenu,
  frequencyText,
  monthName,
  onlyThisDone,
  skipDone,
  type MenuItem,
} from "../app/fixed/fixed-actions-model.ts";

function item(over: Partial<MenuItem>): MenuItem {
  return {
    status: "open",
    event_id: null,
    paid_cents: null,
    planned_cents: "61200",
    due_date: "2026-11-15",
    candidates: [],
    currency: "BRL",
    month: "2026-11-01",
    recurrence: { frequency: "month", every: 1 },
    ...over,
  } as MenuItem;
}

const enabled = (menu: ReturnType<typeof actionMenu>) =>
  Object.fromEntries(menu.entries.map((e) => [e.id, e.enabled]));

test("conta em aberto: todas as ações habilitadas, sem aviso de bloqueio", () => {
  const menu = actionMenu(item({}), false, false);
  assert.deepEqual(enabled(menu), {
    "edit-series": true,
    "only-this": true,
    "this-and-next": true,
    all: true,
    since: true,
    "move-month": true,
    "change-due": true,
    skip: true,
    end: true,
    delete: true,
  });
  assert.equal(menu.blockedNote, null);
  assert.equal(menu.summary, "R$ 612,00 · vence em 15/11 · conta fixa, todo mês");
});

test("conta aguardando conferência ainda está em aberto: nada bloqueado", () => {
  const menu = actionMenu(item({ candidates: [{ amount_cents: "-61200" } as never] }), false, false);
  assert.equal(menu.entries.every((e) => e.enabled), true);
});

test("conta paga: mês, vencimento e pular bloqueados com o motivo; editar e encerrar seguem", () => {
  const paid = item({ status: "done", planned_cents: "8500", paid_cents: "10000" });
  const menu = actionMenu(paid, false, false);
  assert.deepEqual(enabled(menu), {
    "edit-series": true,
    "only-this": true,
    "this-and-next": true,
    all: true,
    since: true,
    "move-month": false,
    "change-due": false,
    skip: false,
    end: true,
    delete: false,
  });
  assert.equal(
    menu.blockedNote,
    "Esta conta já foi paga, por isso não dá para mudar o mês, o vencimento, pular nem excluir. Editar e encerrar continuam disponíveis.",
  );
  assert.equal(menu.summary, "R$ 100,00 · vencia em 15/11 · conta fixa, todo mês");
});

test("motivo muda para conta conciliada e para pagamento parcial", () => {
  const reconciled = actionMenu(item({ status: "done", event_id: "e" }), false, false);
  assert.match(reconciled.blockedNote ?? "", /^Esta conta já está conciliada com o banco/);
  const partial = actionMenu(item({ status: "partial", paid_cents: "100" }), false, false);
  assert.match(partial.blockedNote ?? "", /^Esta conta já teve um pagamento/);
  assert.equal(enabled(partial)["skip"], false);
});

test("leitora só vê o resumo, sem ações nem aviso", () => {
  const menu = actionMenu(item({}), false, true);
  assert.deepEqual(menu.entries, []);
  assert.equal(menu.blockedNote, null);
  assert.match(menu.summary, /R\$ 612,00/);
});

test("valores escondidos no resumo", () => {
  assert.doesNotMatch(actionMenu(item({}), true, false).summary, /612/);
});

test("textos usam o nome do mês da conta", () => {
  const menu = actionMenu(item({ month: "2026-12-01" }), false, false);
  const hints = Object.fromEntries(menu.entries.map((e) => [e.id, e.hint]));
  assert.equal(hints["only-this"], "Muda apenas dezembro");
  assert.equal(hints["change-due"], "Troca o dia, sempre dentro de dezembro");
  assert.equal(hints["end"], "Escolha até quando ela vale");
  assert.equal(monthName("2027-01-01"), "janeiro");
});

test("sem vencimento no resumo", () => {
  assert.match(actionMenu(item({ due_date: null }), false, false).summary, /sem vencimento/);
});

test("frequência em palavras", () => {
  assert.equal(frequencyText("month", 1), "todo mês");
  assert.equal(frequencyText("month", 2), "a cada 2 meses");
  assert.equal(frequencyText("week", 1), "toda semana");
  assert.equal(frequencyText("year", 1), "todo ano");
  assert.equal(frequencyText("day", 3), "a cada 3 dias");
});

test("avisos de sucesso", () => {
  assert.equal(onlyThisDone("2026-11-01"), "Salvo. Só novembro mudou.");
  assert.equal(
    skipDone("Condomínio", "2026-11-01"),
    "Condomínio de novembro foi pulado. Os meses seguintes continuam normais.",
  );
});
