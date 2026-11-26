// Próximas decisões (SPEC-JUDITE-PROFUNDIDADE, Fase 3c): puro. Junta o que o
// servidor já leu (faturas, contas fixas, itens do planejamento, reservas) numa
// lista curta e ordenada por data. A frase de `por_que` é fixa e só afirma o que
// as datas provam; nenhum item nasce sem dado.
import { addDays } from "./day.ts";

export const HORIZON_DAYS = 45;
export const MAX_ITEMS = 8;
/** Sábado e domingo juntos esperam ~29% do gasto (2/7); acima disso o fim de semana pesa. */
export const WEEKEND_SHARE_MIN = 0.4;

export type HorizonKind = "fatura" | "conta_fixa" | "evento_planejado" | "reserva" | "fim_de_semana";
export type HorizonCandidate = { tipo: HorizonKind; data: string; rotulo: string; cents?: bigint; entrada?: boolean };
export type HorizonItem = { tipo: HorizonKind; data: string; rotulo: string; cents?: string; por_que: string };

const SOON = "vence nos próximos dias";

function reason(c: HorizonCandidate, nextIncome: string | null): string {
  const beforeIncome = nextIncome !== null && c.data < nextIncome;
  switch (c.tipo) {
    case "fatura":
      return beforeIncome ? "a fatura chega antes do salário" : SOON;
    case "conta_fixa":
      return beforeIncome ? "a conta vence antes da próxima entrada" : SOON;
    case "evento_planejado":
      return c.entrada ? "entrada marcada no planejamento" : "gasto marcado no planejamento";
    case "reserva":
      return "o prazo da reserva se aproxima e ainda falta guardar";
    case "fim_de_semana":
      return "sábado e domingo levam mais do gasto avulso do que o esperado";
  }
}

/** Dentro do horizonte, do mais próximo ao mais distante, no máximo 8. */
export function buildHorizon(p: { today: string; candidates: readonly HorizonCandidate[]; nextIncome: string | null }) {
  const end = addDays(p.today, HORIZON_DAYS);
  const items: HorizonItem[] = p.candidates
    .filter((c) => c.data >= p.today && c.data <= end)
    .sort((a, b) => a.data.localeCompare(b.data) || a.tipo.localeCompare(b.tipo) || a.rotulo.localeCompare(b.rotulo))
    .slice(0, MAX_ITEMS)
    .map((c) => ({
      tipo: c.tipo,
      data: c.data,
      rotulo: c.rotulo,
      ...(c.cents === undefined ? {} : { cents: c.cents.toString() }),
      por_que: reason(c, p.nextIncome),
    }));
  return items.length ? { de: p.today, ate: end, itens: items } : { de: p.today, ate: end, itens: items, sem_itens: true as const };
}

/** Parte de sábado e domingo no gasto avulso, pelas fatias de distribution(..., "dia_da_semana"). */
export function weekendShare(slices: readonly { fatia: string; cents: number }[]): number | null {
  const total = slices.reduce((s, f) => s + f.cents, 0);
  if (total <= 0) return null;
  return slices.filter((f) => f.fatia === "sábado" || f.fatia === "domingo").reduce((s, f) => s + f.cents, 0) / total;
}

/** Sábado do fim de semana que vem; no sábado ou domingo, hoje. */
export function nextWeekend(today: string): string {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6 ? today : addDays(today, 6 - wd);
}

/** Dia de vencimento dentro do mês (dia 31 num mês de 30 vira 30). */
export function dueOn(month: string, day: number): string {
  const first = `${month}-01`;
  const last = Number(addDays(addMonthStart(first), -1).slice(8));
  return `${month}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function addMonthStart(first: string): string {
  const [y, m] = first.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
