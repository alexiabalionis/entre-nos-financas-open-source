import { test } from "node:test";
import assert from "node:assert/strict";
import { breakdown, weeks } from "../src/domain/copilot-breakdown.ts";
import { heroView, breakdownRows } from "../app/copilot/hero.ts";
import { stepCopy } from "../app/copilot/next-step-copy.ts";
import { apiAmount, moneyOf } from "../app/copilot/money.ts";
import type { CopilotWire } from "../src/server/copilot.ts";

const money = moneyOf(false);
const out = (key: string, date: string, cents: bigint) => ({
  key,
  direction: "out" as const,
  cons: { date, cents },
});

test("breakdown: saldo menos contas e reserva até o dia mais apertado, menos margem", () => {
  const b = breakdown({
    today: "2026-11-05",
    sConf: 503718n,
    flows: [
      out("item:luz", "2026-11-10", 10000n),
      out("bill:card:2026-11", "2026-11-03", 3860n), // vencido: cai em hoje
      out("reserve:p", "2026-11-05", 15000n),
      { key: "inc:sal", direction: "in" as const, cons: { date: "2026-11-25", cents: 480000n } },
    ],
    low: { day: "2026-11-24", cents: 474858n },
    margin: 30000n,
    reserveOnAccount: 1200n,
  });
  assert.equal(b.bills, 13860n);
  assert.equal(b.reserve, 15000n);
  assert.equal(b.income, 0n, "entrada depois do dia mais apertado fica fora");
  assert.equal(b.adjust, 0n);
  assert.equal(b.livre, 474858n - 30000n - 1200n);
  assert.equal(
    b.start + b.income - b.bills - b.reserve + b.adjust - b.margin - b.reserveOnAccount,
    b.livre,
  );
});

test("weeks: semanas de 7 dias até a véspera, contas na semana em que vencem", () => {
  const list = weeks({
    today: "2026-11-10",
    until: "2026-11-24",
    flows: [
      out("item:luz", "2026-11-12", 10000n),
      out("item:escola", "2026-11-20", 50000n),
      out("reserve:p", "2026-11-10", 15000n),
    ],
  });
  assert.deepEqual(
    list.map((w) => [w.from, w.to, w.bills]),
    [
      ["2026-11-10", "2026-11-16", 10000n],
      ["2026-11-17", "2026-11-23", 50000n],
      ["2026-11-24", "2026-11-24", 0n],
    ],
  );
});

function wire(over: Partial<CopilotWire>): CopilotWire {
  return {
    today: "2026-11-10",
    until: "2026-11-23",
    state: "CONFIRMADO",
    status: { kind: "free", livre: "488658" },
    livre: "488658",
    margin: "1200",
    capacity: "488658",
    suggestion: "0",
    target: "50000",
    goal: null,
    action: { kind: "ok", livre: "488658", until: "2026-11-23" },
    overspent: [],
    overdue: [],
    usualWeekly: "180000",
    marginChosen: false,
    daysLeft: 14,
    breakdown: {
      start: "503718",
      income: "0",
      bills: "13860",
      reserve: "0",
      adjust: "0",
      margin: "1200",
      reserveOnAccount: "0",
      livre: "488658",
      lowDay: "2026-11-23",
    },
    weeks: [],
    ...over,
  };
}

test("hero: confiável, apertado, margem, falta e sem dados", () => {
  assert.deepEqual(heroView(wire({}), money).chip, { tone: "ok", label: "Confiável" });
  assert.equal(heroView(wire({}), money).eyebrow, "Livre até 23/11");
  // Cabe por semana menos que o de sempre: apertado.
  const tight = heroView(wire({ usualWeekly: "300000" }), money);
  assert.deepEqual(tight.chip, { tone: "warn", label: "Apertado" });
  assert.match(tight.caption, /gastando menos que o normal/);
  const margin = heroView(wire({ status: { kind: "margin", used: "1000" } }), money);
  assert.equal(margin.value, "R$ 0,00");
  assert.match(margin.caption, /usando R\$ 10,00 da margem de R\$ 12,00/);
  const short = heroView(wire({ status: { kind: "short", missing: "1000" } }), money);
  assert.equal(short.value, "Faltam R$ 10,00");
  assert.equal(short.chip.tone, "danger");
  const none = heroView(wire({ state: "INDETERMINADO" }), money);
  assert.equal(none.value, "Faltam dados");
  assert.equal(none.expandable, false);
});

test("como chegamos: saldo, contas, margem e o livre para o dia a dia", () => {
  const rows = breakdownRows(wire({}), money);
  assert.deepEqual(
    rows.map((r) => [r.title, r.trail]),
    [
      ["Na conta hoje", "R$ 5.037,18"],
      ["Contas até 23/11", "−R$ 138,60"],
      ["Margem de segurança", "−R$ 12,00"],
      ["Livre para o dia a dia", "R$ 4.886,58"],
    ],
  );
  assert.equal(rows[2].sub, "padrão: meia semana do dia a dia");
});

test("próximo passo: textos de cada caso", () => {
  const need = stepCopy(
    wire({ action: { kind: "need_data", gap: { key: "saldo:x", quality: "unbounded", impact: "unbounded", reason: "" } } }),
    money,
  );
  assert.match(need!.body, /Atualize o saldo/);
  const short = stepCopy(
    wire({
      action: {
        kind: "short",
        missing: "15000",
        until: "2026-11-23",
        overspent: [{ category: "Delivery", over: "20000" }],
        canPausePlan: false,
      },
    }),
    money,
  );
  assert.equal(short!.meta, "Acima do normal: delivery +R$ 200,00");
  assert.match(short!.body, /Faltam R\$ 150,00/);
  assert.equal(stepCopy(wire({}), money)!.title, "Tudo certo por agora");
  assert.equal(
    stepCopy(wire({ action: { kind: "decide", suggestion: "17000", capacity: "34000" } }), money),
    null,
  );
});

test("apiAmount: centavos no formato da API", () => {
  assert.equal(apiAmount(15000n), "150,00");
  assert.equal(apiAmount(1005n), "10,05");
});
