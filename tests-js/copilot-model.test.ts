import { test } from "node:test";
import assert from "node:assert/strict";
import {
  caption,
  chip,
  history,
  insight,
  lastDeclared,
  monthProgressText,
  pace,
  parseAmount,
  pendingText,
  railPct,
  type Goal,
  type Movement,
} from "../app/copilot/model.ts";
import { moneyOf, signedMoney } from "../app/copilot/money.ts";

const money = moneyOf(false);
const TODAY = "2026-11-19";

const mv = (
  date: string,
  reais: number,
  verified = true,
  id = date + reais,
): Movement => ({
  id,
  kind: reais > 0 ? "deposit" : "withdrawal",
  cents: String(Math.abs(reais) * 100),
  date,
  verified,
});

function goal(moves: Movement[], over: Partial<Goal> = {}): Goal {
  const saved = moves.reduce(
    (a, m) => a + (m.kind === "deposit" ? 1n : -1n) * BigInt(m.cents),
    0n,
  );
  return {
    id: "g",
    name: "Primeira reserva",
    target_cents: "45000",
    deadline_month: null,
    priority: 1,
    status: "active",
    location: "same_account",
    version: 1,
    saved_cents: saved.toString(),
    verified_cents: "0",
    declared_cents: "0",
    current_plan: null,
    movements: [...moves].sort((a, b) => (a.date < b.date ? 1 : -1)),
    ...over,
  };
}

const SEP_OCT = [mv("2026-09-06", 100), mv("2026-10-06", 120), mv("2026-10-21", -50)];

test("cartão vazio: sem movimentos, convite e meta", () => {
  const g = goal([]);
  assert.deepEqual(chip(g), { tone: "neutral", label: "Sem movimentos" });
  assert.equal(
    caption(g, money),
    "Quando o salário entrar, guarde um pouco aqui. A meta é R$ 450,00.",
  );
  assert.equal(railPct(g), 0);
  assert.equal(pendingText([], money), "Ainda não há nada guardado.");
});

test("com pendente: chip aguardando, leitura do pendente e falta", () => {
  const g = goal([...SEP_OCT, mv("2026-11-06", 150, false)]);
  assert.deepEqual(chip(g), { tone: "accent", label: "Aguardando o extrato" });
  assert.equal(caption(g, money), "Faltam R$ 130,00 para R$ 450,00.");
  assert.equal(railPct(g), 71);
  assert.equal(
    insight(g, TODAY, money),
    "R$ 150,00 ainda não apareceram no extrato.",
  );
  assert.equal(
    pendingText(g.movements, money),
    "R$ 170,00 confirmados no extrato, R$ 150,00 guardados informados por você.",
  );
  assert.equal(lastDeclared(g)?.date, "2026-11-06");
});

test("retirada pendente aparece separada da soma", () => {
  const g = goal([...SEP_OCT, mv("2026-11-19", -50, false)]);
  assert.equal(
    insight(g, TODAY, money),
    "A retirada de R$ 50,00 ainda não apareceu no extrato.",
  );
  assert.match(pendingText(g.movements, money), /R\$ 50,00 de retirada informada/);
});

test("tudo confirmado, sem prazo: frequência dos últimos meses", () => {
  const g = goal(SEP_OCT);
  assert.deepEqual(chip(g), { tone: "ok", label: "Confirmado no extrato" });
  assert.equal(insight(g, TODAY, money), "Guardou em 2 dos últimos 3 meses.");
});

test("com prazo: quanto por mês até o prazo e a média", () => {
  const g = goal(
    [mv("2026-09-06", 200), mv("2026-10-06", 200)],
    { target_cents: "300000", deadline_month: "2027-07-01" },
  );
  assert.equal(caption(g, money), "Faltam R$ 2.600,00 para R$ 3.000,00, até 07/2027.");
  assert.equal(
    insight(g, TODAY, money),
    "Faltam R$ 2.600,00 em 8 meses: cerca de R$ 325,00 por mês. Nos últimos meses você guardou em média R$ 200,00.",
  );
});

test("objetivo atingido", () => {
  const g = goal([mv("2026-10-06", 300), mv("2026-11-06", 150)]);
  assert.deepEqual(chip(g), { tone: "ok", label: "Objetivo atingido" });
  assert.equal(caption(g, money), "Meta de R$ 450,00 alcançada.");
  assert.equal(railPct(g), 100);
  assert.equal(
    insight(g, TODAY, money),
    "Chegou nos R$ 450,00. O dinheiro segue guardado.",
  );
});

test("histórico por mês, do mais novo ao mais antigo, com total do mês", () => {
  const groups = history(goal(SEP_OCT));
  assert.deepEqual(
    groups.map((h) => [h.month, h.total, h.rows.length]),
    [
      ["2026-10", 7000n, 2],
      ["2026-09", 10000n, 1],
    ],
  );
  assert.equal(signedMoney(money, -5000n), "−R$ 50,00");
  assert.equal(signedMoney(money, 7000n), "+R$ 70,00");
});

test("parseAmount: valida sem converter em silêncio", () => {
  assert.deepEqual(parseAmount("50", null, money), { ok: true, value: "50,00", cents: 5000n });
  assert.deepEqual(parseAmount("1.250,5", null, money), {
    ok: true,
    value: "1.250,50",
    cents: 125050n,
  });
  assert.deepEqual(parseAmount("", null, money), { ok: false, error: "Informe o valor." });
  assert.equal(parseAmount("abc", null, money).ok, false);
  assert.equal(parseAmount("50.5", null, money).ok, false);
  assert.deepEqual(parseAmount("0", null, money), {
    ok: false,
    error: "Informe um valor maior que zero.",
  });
  assert.deepEqual(parseAmount("80", 5000n, money), {
    ok: false,
    error: "Você tem R$ 50,00 guardados neste objetivo. Informe um valor até esse.",
  });
});

test("ocultar valores esconde o dinheiro", () => {
  assert.equal(moneyOf(true)(5000n), "••••");
});

test("pace: ritmo atual abaixo do necessário até o prazo", () => {
  const g = goal(
    [mv("2026-09-06", 200), mv("2026-10-06", 200)],
    { target_cents: "300000", deadline_month: "2027-07-01" },
  );
  assert.deepEqual(pace(g, TODAY), { tone: "warn", label: "Abaixo do ritmo" });
});

test("pace: média cobre o necessário até o prazo", () => {
  const g = goal(
    [mv("2026-09-06", 400), mv("2026-10-06", 400)],
    { target_cents: "300000", deadline_month: "2027-07-01" },
  );
  assert.deepEqual(pace(g, TODAY), { tone: "ok", label: "No ritmo para a meta" });
});

test("pace: sem prazo não há o que avaliar", () => {
  const g = goal(SEP_OCT);
  assert.equal(pace(g, TODAY), null);
});

test("pace: pouco histórico cai para o valor combinado do mês", () => {
  const g = goal([mv("2026-11-06", 50)], {
    target_cents: "300000",
    deadline_month: "2027-07-01",
    current_plan: { id: "p1", goal_id: "g", month: "2026-11-01", planned_cents: "40000" },
  });
  assert.deepEqual(pace(g, TODAY), { tone: "ok", label: "No ritmo para a meta" });
});

test("pace: pouco histórico e sem plano combinado pede um valor por mês", () => {
  const g = goal([mv("2026-11-06", 50)], {
    target_cents: "300000",
    deadline_month: "2027-07-01",
  });
  assert.deepEqual(pace(g, TODAY), {
    tone: "neutral",
    label: "Combine um valor por mês para ver o ritmo",
  });
});

test("monthProgressText: guardado do mês contra o combinado, só o guardado, ou travessão", () => {
  const withPlan = goal([mv("2026-11-06", 50)], {
    current_plan: { id: "p1", goal_id: "g", month: "2026-11-01", planned_cents: "15000" },
  });
  assert.equal(monthProgressText(withPlan, TODAY, money), "R$ 50,00 de R$ 150,00");

  const noPlanButSaved = goal([mv("2026-11-06", 50)]);
  assert.equal(monthProgressText(noPlanButSaved, TODAY, money), "R$ 50,00");

  const nothingThisMonth = goal([mv("2026-09-06", 50)]);
  assert.equal(monthProgressText(nothingThisMonth, TODAY, money), "—");
});
