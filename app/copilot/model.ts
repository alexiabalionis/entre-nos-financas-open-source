// Modelo puro da tela Copiloto (reservas por objetivo). Sem React, sem fetch:
// recebe o que GET reserves devolve e entrega textos, tons e números prontos.
import type { listGoals } from "../../src/server/reserves.ts";
import type { Tone } from "../ds/shared.ts";
import type { RowProps } from "../ds/row.tsx";
import { cents } from "../../src/domain/finance.ts";
import { ddmm } from "../month/format.ts";
import { signedMoney, type Money } from "./money.ts";

export type Goal = Awaited<ReturnType<typeof listGoals>>[number];
export type Movement = Goal["movements"][number];

const big = (v: string) => BigInt(v);
export const signed = (m: Movement) =>
  m.kind === "deposit" ? big(m.cents) : -big(m.cents);
const sum = (list: readonly bigint[]) => list.reduce((a, b) => a + b, 0n);
const monthOf = (day: string) => day.slice(0, 7);

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

export function saved(goal: Goal): bigint {
  return big(goal.saved_cents);
}
export function reached(goal: Goal): boolean {
  return goal.status === "done" || saved(goal) >= big(goal.target_cents);
}
export function railPct(goal: Goal): number {
  const target = big(goal.target_cents);
  if (target <= 0n) return 0;
  const pct = (saved(goal) * 100n) / target;
  return Number(pct > 100n ? 100n : pct < 0n ? 0n : pct);
}
export function target(goal: Goal): bigint {
  return big(goal.target_cents);
}
export function remaining(goal: Goal): bigint {
  return reached(goal) ? 0n : target(goal) - saved(goal);
}
export function monthlyPlanned(goal: Goal): bigint | null {
  return goal.current_plan ? big(goal.current_plan.planned_cents) : null;
}
// Inicial do nome pro badge do cartão — sem mapa de ícones por objetivo.
export function initial(goal: Goal): string {
  return goal.name.trim().charAt(0).toUpperCase() || "•";
}

// Nome de uma reserva nova ou editada — mesmo limite da coluna no banco.
export function validateName(name: string): string {
  const n = name.trim();
  if (!n) return "Dê um nome para a reserva.";
  if (n.length > 80) return "Use um nome mais curto (até 80 letras).";
  return "";
}

// Líquido guardado só no mês de `today` — para comparar com o combinado do
// mês (current_plan), distinto do total guardado desde sempre.
export function monthSaved(goal: Goal, today: string): bigint {
  const m = monthOf(today);
  return sum(
    goal.movements.filter((mv) => monthOf(mv.date) === m).map(signed),
  );
}

// "Este mês": guardado / combinado, ou só o guardado sem combinado, ou "—".
export function monthProgressText(
  goal: Goal,
  today: string,
  money: Money,
): string {
  const planned = monthlyPlanned(goal);
  const done = monthSaved(goal, today);
  if (planned !== null) return `${money(done)} de ${money(planned)}`;
  return done > 0n ? money(done) : "—";
}

// Veredito do ritmo: dá pra chegar na meta até o prazo? Sem prazo (ou já
// alcançado/pausado) não há o que avaliar -> null, o cartão só não mostra.
// Prefere a média real dos últimos meses; sem histórico (< 2 meses), cai pro
// valor combinado para este mês — é o melhor sinal de intenção disponível.
export function pace(goal: Goal, today: string): { tone: Tone; label: string } | null {
  if (goal.status !== "active" || !goal.deadline_month || reached(goal))
    return null;
  const left = remaining(goal);
  if (left <= 0n) return null;
  const n = BigInt(
    Math.max(1, monthsBetween(monthOf(today), monthOf(goal.deadline_month))),
  );
  const neededPerMonth = (left + n - 1n) / n;
  const months = [...new Set(goal.movements.map((m) => monthOf(m.date)))];
  const actual =
    months.length >= 2
      ? sum(goal.movements.filter((m) => m.kind === "deposit").map(signed)) /
        BigInt(months.length)
      : monthlyPlanned(goal);
  if (actual === null)
    return { tone: "neutral", label: "Combine um valor por mês para ver o ritmo" };
  return actual >= neededPerMonth
    ? { tone: "ok", label: "No ritmo para a meta" }
    : { tone: "warn", label: "Abaixo do ritmo" };
}

// Uma linha de movimento (ícone, título, data e valor) — usada no preview
// recente do cartão e dentro do histórico completo (GoalHistory).
export function movementRow(m: Movement, money: Money): RowProps {
  const tone = m.verified ? "ok" : "accent";
  return {
    icon: m.kind === "deposit" ? "↑" : "↓",
    tone,
    title: m.kind === "deposit" ? "Guardado" : "Retirada",
    sub: `${ddmm(m.date)} · ${m.verified ? "confirmado no extrato" : "informado por você, aguardando o extrato"}`,
    trail: { value: signedMoney(money, signed(m)), tone },
  };
}

export function chip(goal: Goal): { tone: Tone; label: string } {
  if (goal.status === "paused") return { tone: "neutral", label: "Pausado" };
  if (reached(goal)) return { tone: "ok", label: "Objetivo atingido" };
  if (!goal.movements.length)
    return { tone: "neutral", label: "Sem movimentos" };
  return goal.movements.some((m) => !m.verified)
    ? { tone: "accent", label: "Aguardando o extrato" }
    : { tone: "ok", label: "Confirmado no extrato" };
}

const deadlineText = (month: string) =>
  `${month.slice(5, 7)}/${month.slice(0, 4)}`;

export function caption(goal: Goal, money: Money): string {
  const target = big(goal.target_cents);
  if (!goal.movements.length)
    return `Quando o salário entrar, guarde um pouco aqui. A meta é ${money(target)}.`;
  if (reached(goal)) return `Meta de ${money(target)} alcançada.`;
  const left = target - saved(goal);
  const until = goal.deadline_month
    ? `, até ${deadlineText(goal.deadline_month)}`
    : "";
  return `Faltam ${money(left)} para ${money(target)}${until}.`;
}

// Entradas e retiradas ainda sem extrato, separadas para a retirada não sumir
// dentro de uma soma.
function pending(moves: readonly Movement[]) {
  const open = moves.filter((m) => !m.verified);
  return {
    in: sum(open.filter((m) => m.kind === "deposit").map(signed)),
    out: -sum(open.filter((m) => m.kind === "withdrawal").map(signed)),
  };
}

export function pendingText(moves: readonly Movement[], money: Money): string {
  if (!moves.length) return "Ainda não há nada guardado.";
  const p = pending(moves);
  if (!p.in && !p.out) return "Tudo confirmado no extrato.";
  const ok = sum(moves.filter((m) => m.verified).map(signed));
  const parts = ok ? [`${money(ok)} confirmados no extrato`] : [];
  if (p.in) parts.push(`${money(p.in)} guardados informados por você`);
  if (p.out) parts.push(`${money(p.out)} de retirada informada por você`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}

// Uma leitura curta por objetivo. Vazio quando ainda não há o que dizer.
export function insight(goal: Goal, today: string, money: Money): string {
  const p = pending(goal.movements);
  if (p.in || p.out)
    return [
      p.in ? `${money(p.in)} ainda não apareceram no extrato.` : "",
      p.out ? `A retirada de ${money(p.out)} ainda não apareceu no extrato.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  if (reached(goal))
    return `Chegou nos ${money(big(goal.target_cents))}. O dinheiro segue guardado.`;
  const months = [...new Set(goal.movements.map((m) => monthOf(m.date)))];
  if (months.length < 2) return "";
  const current = monthOf(today);
  if (goal.deadline_month && goal.status === "active") {
    const left = big(goal.target_cents) - saved(goal);
    const n = BigInt(
      Math.max(1, monthsBetween(current, monthOf(goal.deadline_month))),
    );
    const deposits = sum(
      goal.movements.filter((m) => m.kind === "deposit").map(signed),
    );
    const average = deposits / BigInt(months.length);
    return `Faltam ${money(left)} em ${n} meses: cerca de ${money((left + n - 1n) / n)} por mês. Nos últimos meses você guardou em média ${money(average)}.`;
  }
  const first = months.reduce((a, b) => (a < b ? a : b));
  const span = Math.min(3, monthsBetween(first, current) + 1);
  const recent = new Set(
    Array.from({ length: span }, (_, i) => shift(current, -i)),
  );
  const done = new Set(
    goal.movements
      .filter((m) => m.kind === "deposit" && recent.has(monthOf(m.date)))
      .map((m) => monthOf(m.date)),
  ).size;
  return `Guardou em ${done} dos últimos ${span} meses.`;
}

function shift(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export type HistoryMonth = { month: string; total: bigint; rows: Movement[] };

// Histórico agrupado por mês, do mais novo ao mais antigo (a API já ordena).
export function history(goal: Goal): HistoryMonth[] {
  const groups = new Map<string, Movement[]>();
  for (const m of goal.movements) {
    const key = monthOf(m.date);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, rows]) => ({ month, total: sum(rows.map(signed)), rows }));
}

// Último movimento informado (sem extrato): é o que "Desfazer" cancela.
export function lastDeclared(goal: Goal): Movement | null {
  return goal.movements.find((m) => !m.verified) ?? null;
}

export function totals(goals: readonly Goal[]) {
  return {
    total: sum(goals.map(saved)),
    moves: goals.flatMap((g) => g.movements),
  };
}

// Valor digitado em reais -> texto no formato da API ("50,00"). Nunca vira
// null em silêncio: devolve o erro para mostrar no campo.
export function parseAmount(
  raw: string,
  max: bigint | null,
  money: Money,
):
  | { ok: true; value: string; cents: bigint }
  | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Informe o valor." };
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(text))
    return { ok: false, error: "Use só números, como 50 ou 80,50." };
  const [whole, dec = ""] = text.split(",");
  const value = `${whole},${dec.padEnd(2, "0")}`;
  const parsed = cents(value);
  if (parsed <= 0n) return { ok: false, error: "Informe um valor maior que zero." };
  if (max !== null && parsed > max)
    return {
      ok: false,
      error: `Você tem ${money(max)} guardados neste objetivo. Informe um valor até esse.`,
    };
  return { ok: true, value, cents: parsed };
}
