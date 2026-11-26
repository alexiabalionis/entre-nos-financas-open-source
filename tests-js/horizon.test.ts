import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHorizon, dueOn, nextWeekend, weekendShare, type HorizonCandidate } from "../src/domain/horizon.ts";

const TODAY = "2026-11-23";
const c = (tipo: HorizonCandidate["tipo"], data: string, rotulo: string, cents?: bigint): HorizonCandidate => ({ tipo, data, rotulo, ...(cents === undefined ? {} : { cents }) });

test("buildHorizon: do mais próximo ao mais distante, só dentro de 45 dias", () => {
  const out = buildHorizon({
    today: TODAY,
    nextIncome: null,
    candidates: [
      c("reserva", "2026-12-31", "Reserva Viagem", 100000n),
      c("fatura", "2026-12-03", "Fatura Roxo", 45000n),
      c("conta_fixa", "2026-11-22", "Aluguel (ontem)", 1n),
      c("conta_fixa", "2027-01-08", "Escola (46 dias)", 1n),
      c("conta_fixa", "2027-01-07", "Internet (45 dias)", 12000n),
    ],
  });
  assert.deepEqual(out.itens.map((i) => i.rotulo), ["Fatura Roxo", "Reserva Viagem", "Internet (45 dias)"]);
  assert.equal(out.itens[0]!.cents, "45000");
  assert.equal("sem_itens" in out, false);
});

test("buildHorizon: no máximo 8 itens, os mais próximos", () => {
  const candidates = Array.from({ length: 12 }, (_, k) => c("conta_fixa", `2026-12-${String(k + 1).padStart(2, "0")}`, `Conta ${k}`));
  const out = buildHorizon({ today: TODAY, nextIncome: null, candidates });
  assert.equal(out.itens.length, 8);
  assert.equal(out.itens.at(-1)!.rotulo, "Conta 7");
});

test("buildHorizon: sem dado não inventa item e marca sem_itens", () => {
  const out = buildHorizon({ today: TODAY, nextIncome: "2026-12-05", candidates: [] });
  assert.deepEqual(out.itens, []);
  assert.equal("sem_itens" in out && out.sem_itens, true);
});

test("por_que: 'antes do salário' só quando a data prova; senão a frase neutra", () => {
  const candidates = [c("fatura", "2026-12-03", "A"), c("fatura", "2026-12-10", "B"), c("conta_fixa", "2026-12-04", "C"), c("evento_planejado", "2026-12-20", "IPVA")];
  const before = buildHorizon({ today: TODAY, nextIncome: "2026-12-05", candidates });
  const why = (rotulo: string) => before.itens.find((i) => i.rotulo === rotulo)!.por_que;
  assert.equal(why("A"), "a fatura chega antes do salário");
  assert.equal(why("B"), "vence nos próximos dias");
  assert.equal(why("C"), "a conta vence antes da próxima entrada");
  assert.equal(why("IPVA"), "gasto marcado no planejamento");
  const unknown = buildHorizon({ today: TODAY, nextIncome: null, candidates });
  assert.equal(unknown.itens.find((i) => i.rotulo === "A")!.por_que, "vence nos próximos dias");
});

test("weekendShare: sábado e domingo juntos sobre o total; sem gasto não há parte", () => {
  const slice = (fatia: string, cents: number) => ({ fatia, cents });
  assert.equal(weekendShare([slice("segunda", 6000), slice("sábado", 2500), slice("domingo", 1500)]), 0.4);
  assert.equal(weekendShare([slice("segunda", 0), slice("sábado", 0)]), null);
});

test("nextWeekend: sábado da semana; no fim de semana, hoje", () => {
  assert.equal(nextWeekend("2026-11-23"), "2026-11-28");
  assert.equal(nextWeekend("2026-11-28"), "2026-11-28");
  assert.equal(nextWeekend("2026-11-29"), "2026-11-29");
});

test("dueOn: dia 31 num mês de 30 dias vira 30", () => {
  assert.equal(dueOn("2026-11", 31), "2026-11-30");
  assert.equal(dueOn("2027-02", 30), "2027-02-28");
  assert.equal(dueOn("2026-12", 5), "2026-12-05");
});
