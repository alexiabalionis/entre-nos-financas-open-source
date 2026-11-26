// Ferramentas da visão do mês e do planejamento: cada uma lê exatamente o que
// a tela correspondente mostra (Copiloto, Contas fixas, Cartões, Reservas).
import { settledToday } from "./bank-settled.ts";
import { readCardProjection } from "./cards.ts";
import { readCopilot } from "./copilot.ts";
import { readFixedOverview } from "./recurrence-overview.ts";
import { listGoals } from "./reserves.ts";
import { readProjectionMonth } from "./projection.ts";
import { summarizeFlowBuckets, withinHorizon } from "../../app/projection-view.ts";
import type { ToolDeps } from "./judite-tools-schema.ts";

const str = (v: bigint) => v.toString();

export async function currentMonthTool(deps: ToolDeps): Promise<unknown> {
  const c = await readCopilot(deps.db, deps.user);
  const b = c.breakdown;
  return {
    hoje: c.today,
    ate: c.until,
    dias_restantes: c.daysLeft,
    livre_cents: str(c.livre),
    situacao: c.status.kind,
    confianca: c.state,
    de_onde_vem: {
      saldo_inicio_cents: str(b.start),
      entradas_ate_la_cents: str(b.income),
      contas_ate_la_cents: str(b.bills),
      reserva_cents: str(b.reserve),
      ajuste_cents: str(b.adjust),
      margem_cents: str(b.margin),
      dia_mais_apertado: b.lowDay,
    },
    ritmo_semanal_cents: c.usualWeekly === null ? null : str(c.usualWeekly),
    atrasadas: c.overdue.map((o) => ({ nome: o.label, vencimento: o.due, valor_cents: str(o.amount) })),
    acima_do_ritmo: c.overspent.map((o) => ({ categoria: o.category, acima_cents: str(o.over) })),
  };
}

export async function fixedBillsTool(deps: ToolDeps, mes?: string): Promise<unknown> {
  const today = settledToday();
  const month = mes ?? today.slice(0, 7);
  const o = await readFixedOverview(deps.db, deps.user, { month });
  const status = (x: { status: string; event_id: string | null; due_date: string | null; occurrence_date: string }) =>
    x.event_id !== null || x.status === "done"
      ? "paga"
      : x.status === "partial"
        ? "parcial"
        : (x.due_date ?? x.occurrence_date) < today
          ? "atrasada"
          : "pendente";
  return {
    mes: month,
    total_cents: o.total_cents,
    contas: o.series.flatMap((s) =>
      s.occurrences
        .filter((x) => !x.archived)
        .map((x) => ({
          nome: s.label,
          vencimento: x.due_date ?? x.occurrence_date,
          valor_cents: x.paid_cents ?? x.planned_cents ?? s.expected_cents,
          situacao: status(x),
          ...(s.card ? { cartao: s.card.name } : {}),
        })),
    ),
  };
}

export async function cardsTool(deps: ToolDeps, mes?: string): Promise<unknown> {
  const month = mes ?? settledToday().slice(0, 7);
  const p = await readCardProjection(deps.db, deps.user, month);
  return {
    a_partir_de: month,
    cartoes: p.cards.map((c) => ({
      cartao: c.name,
      faturas: c.months.map((m) => ({
        vencimento_mes: m.due_month,
        total_cents: m.total_cents,
        origem: m.source === "bank" ? "banco" : m.source === "cycle" ? "estimada" : "parcial",
        provisoria: m.provisional,
        compras: m.purchase_count,
      })),
    })),
  };
}

export async function reservesTool(deps: ToolDeps): Promise<unknown> {
  const goals = await listGoals(deps.db, deps.user);
  return {
    // Não confundir com metas e limites combinados em conversa (search_memory).
    o_que_e: "Reservas cadastradas no app: dinheiro guardado para um fim, com alvo e prazo.",
    objetivos: goals.map((g) => {
      const target = BigInt(g.target_cents);
      const saved = BigInt(g.saved_cents);
      return {
        nome: g.name,
        situacao: g.status,
        alvo_cents: g.target_cents,
        guardado_cents: g.saved_cents,
        falta_cents: str(target > saved ? target - saved : 0n),
        prazo: g.deadline_month?.slice(0, 7) ?? null,
        combinado_do_mes_cents: g.current_plan?.planned_cents ?? null,
      };
    }),
  };
}

const KIND: [prefix: string, tipo: string][] = [
  ["bill:", "fatura de cartão"],
  ["cardplan:", "compras de cartão previstas"],
  ["sched:", "agendado no banco"],
];

/**
 * "O que falta pagar": a mesma lista do "Vem aí" da aba Mês (fluxos em aberto
 * do motor de caixa, já conciliados), recortada ao fim do mês atual. A fatura
 * entra como fatura: as compras do cartão não aparecem de novo, e a conta fixa
 * paga no cartão já está dentro dela. O que já foi pago está no saldo, não aqui.
 */
export async function billsDueTool(deps: ToolDeps): Promise<unknown> {
  const p = await readProjectionMonth(deps.db, deps.user);
  if (p.mode !== "current") return { erro: "Só consigo listar o que falta pagar no mês atual." };
  const out = withinHorizon(p.flows, p.monthEnd).filter((f) => f.direction === "out");
  const late = out.filter((f) => f.nom.date < p.today);
  const buckets = summarizeFlowBuckets(out);
  const lateBuckets = summarizeFlowBuckets(late);
  const sum = (b: typeof buckets) => (BigInt(b.firmCents) + BigInt(b.estimatedCents)).toString();
  return {
    hoje: p.today,
    ate: p.monthEnd,
    o_que_e: "Compromissos em aberto até o fim do mês, como no Vem aí da aba Mês: faturas pelo valor da fatura, contas fixas fora do cartão, agendados e planejados.",
    total_cents: sum(buckets),
    certo_cents: buckets.firmCents,
    estimado_cents: buckets.estimatedCents,
    atrasadas: late.length,
    atrasadas_cents: sum(lateBuckets),
    itens: out.map((f) => ({
      nome: f.label,
      tipo: KIND.find(([prefix]) => f.key.startsWith(prefix))?.[1] ?? "conta ou planejado",
      vencimento: f.nom.date,
      valor_cents: f.cons.cents,
      situacao: f.nom.date < p.today ? "atrasada" : "a vencer",
      valor: f.quality === "estimated" || f.quality === "inconsistent" ? "estimado" : "certo",
    })),
  };
}
