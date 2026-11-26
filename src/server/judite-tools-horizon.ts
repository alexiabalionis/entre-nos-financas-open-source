// Ferramenta proximas_decisoes (SPEC-JUDITE-PROFUNDIDADE, Fase 3c): o que vence
// ou se decide nos próximos 45 dias. Só junta leituras que já existem (falta_pagar,
// cartoes, contas_fixas, reservas, projeção e a distribuição por dia da semana);
// a escolha, a ordem e as frases ficam em src/domain/horizon.ts.
import { addDays } from "../domain/day.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { distribution } from "../domain/spend-investigate.ts";
import { buildHorizon, dueOn, HORIZON_DAYS, nextWeekend, WEEKEND_SHARE_MIN, weekendShare, type HorizonCandidate } from "../domain/horizon.ts";
import { settledToday } from "./bank-settled.ts";
import { billsDueTool, cardsTool, fixedBillsTool, reservesTool } from "./judite-tools-month.ts";
import { resolveScope } from "./judite-tools-investigate.ts";
import type { ToolDeps } from "./judite-tools-schema.ts";

// Conta fixa criada a partir do banco carrega a descrição ("Pix enviado ROBERTO ..."): o nome de quem
// recebe nunca vai ao provedor. Rótulo escrito pela casa ("Aulas de bateria") fica como está.
const TRANSFER = /\b(pix|ted|doc|transf\w*)\b/i;
const safeLabel = (label: string) => (TRANSFER.test(label) ? (/\bpix\b/i.test(label) ? "Pix enviado" : "Transferência enviada") : label);

type Plan = Awaited<ReturnType<ToolDeps["futurePlan"]>>;

const big = (v: unknown) => BigInt(String(v));

/** Faturas em aberto do mês (valor da fatura, já conciliado) e as dos meses seguintes. */
async function cardBills(deps: ToolDeps, plan: Plan, today: string, end: string): Promise<HorizonCandidate[]> {
  const month = today.slice(0, 7);
  const due = (await billsDueTool(deps)) as { itens?: { nome: string; tipo: string; vencimento: string; valor_cents: unknown; situacao: string }[] };
  const open = (due.itens ?? [])
    .filter((i) => i.tipo === "fatura de cartão" && i.situacao === "a vencer")
    .map((i): HorizonCandidate => ({ tipo: "fatura", data: i.vencimento, rotulo: safeLabel(i.nome), cents: big(i.valor_cents) }));
  const cards = (await cardsTool(deps, month)) as { cartoes: { cartao: string; faturas: { vencimento_mes: string; total_cents: string }[] }[] };
  const later = cards.cartoes.flatMap((c) => {
    const cycle = plan.input.cards.find((x) => x.name === c.cartao)?.cycles.at(-1);
    if (!cycle) return [];
    return c.faturas
      .filter((f) => f.vencimento_mes > month && BigInt(f.total_cents) > 0n)
      .map((f): HorizonCandidate => ({ tipo: "fatura", data: dueOn(f.vencimento_mes, cycle.due_day), rotulo: `Fatura ${c.cartao}`, cents: BigInt(f.total_cents) }))
      .filter((f) => f.data <= end);
  });
  return [...open, ...later];
}

/** Contas fixas ainda não pagas e fora do cartão: a cobrada no cartão já está dentro da fatura. */
async function fixedBills(deps: ToolDeps, today: string, end: string): Promise<HorizonCandidate[]> {
  const seen = new Map<string, HorizonCandidate>();
  for (let m = today.slice(0, 7); m <= end.slice(0, 7); m = shiftMonth(m, 1)) {
    const r = (await fixedBillsTool(deps, m)) as { contas: { nome: string; vencimento: string; valor_cents: unknown; situacao: string; cartao?: string }[] };
    for (const c of r.contas) {
      if (c.cartao || c.situacao === "paga" || c.vencimento < today || c.vencimento > end) continue;
      seen.set(`${c.nome}|${c.vencimento}`, { tipo: "conta_fixa", data: c.vencimento, rotulo: safeLabel(c.nome), cents: big(c.valor_cents) });
    }
  }
  return [...seen.values()];
}

/** Itens com nome e data que a casa pôs no planejamento (13º, IPVA): fora de série. */
function plannedEvents(plan: Plan): HorizonCandidate[] {
  const pick = (list: Plan["input"]["fixed"], entrada: boolean) =>
    list.flatMap((m) =>
      m.items.flatMap((l): HorizonCandidate[] => (l.source === "plano" && l.date ? [{ tipo: "evento_planejado", data: l.date, rotulo: safeLabel(l.label), cents: l.cents, entrada }] : [])),
    );
  return [...pick(plan.input.fixed, false), ...pick(plan.input.income, true)];
}

async function reserveDeadlines(deps: ToolDeps): Promise<HorizonCandidate[]> {
  const r = (await reservesTool(deps)) as { objetivos: { nome: string; situacao: string; prazo: string | null; falta_cents: string }[] };
  return r.objetivos
    .filter((g) => g.situacao === "active" && g.prazo && BigInt(g.falta_cents) > 0n)
    .map((g): HorizonCandidate => ({ tipo: "reserva", data: dueOn(g.prazo!, 31), rotulo: `Reserva ${g.nome}`, cents: BigInt(g.falta_cents) }));
}

/** Só quando sábado e domingo juntos levam mais de 40% do gasto avulso dos 3 meses fechados. */
async function weekend(deps: ToolDeps, today: string): Promise<HorizonCandidate[]> {
  if (!(await deps.spend(3)).purchases.length) return [];
  const { ctx } = await resolveScope(deps, { meses: 3 });
  const share = weekendShare(distribution(ctx, ctx.avulso, "dia_da_semana").fatias);
  return share !== null && share > WEEKEND_SHARE_MIN ? [{ tipo: "fim_de_semana", data: nextWeekend(today), rotulo: "Próximo fim de semana" }] : [];
}

export async function horizonTool(deps: ToolDeps): Promise<unknown> {
  const today = settledToday();
  const end = addDays(today, HORIZON_DAYS);
  const plan = await deps.futurePlan();
  const nextIncome =
    plan.input.income
      .flatMap((m) => m.items.flatMap((l) => (l.date && l.date >= today ? [l.date] : [])))
      .sort()[0] ?? null;
  const candidates = [
    ...(await cardBills(deps, plan, today, end)),
    ...(await fixedBills(deps, today, end)),
    ...plannedEvents(plan),
    ...(await reserveDeadlines(deps)),
    ...(await weekend(deps, today)),
  ];
  return buildHorizon({ today, candidates, nextIncome });
}
