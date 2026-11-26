// Pausar a reserva quando o mês aperta (puro). Pausar = o plano do mês passa
// a valer só o que já foi separado; o que faltava separar volta a contar como
// livre. Nada é apagado: o plano anterior fica guardado para voltar.
import type { CopilotWire } from "../../src/server/copilot.ts";
import { moneyStatus, type MoneyStatus } from "../../src/domain/reserve-suggestion.ts";
import type { Money } from "./money.ts";

type PlanWire = NonNullable<NonNullable<CopilotWire["goal"]>["plan"]>;

// Valor do plano antes da pausa, quando o plano atual é uma pausa: caiu para
// zero depois de ter valor. Reduzir e separar tudo não conta como pausa (o
// cartão mostra o que foi guardado). null quando não é pausa.
export function pausedFrom(plan: PlanWire | null): bigint | null {
  if (!plan || plan.previous === null) return null;
  const previous = BigInt(plan.previous);
  return previous > 0n && BigInt(plan.planned) === 0n ? previous : null;
}

// Quanto o plano passa a valer ao pausar: o que já foi separado.
export function pausedPlanned(plan: PlanWire): bigint {
  return BigInt(plan.separated);
}

function statusText(s: MoneyStatus, money: Money): string {
  if (s.kind === "free") return `${money(s.livre)} livres`;
  if (s.kind === "zero") return "contas cobertas, sem folga";
  if (s.kind === "margin") return `usando ${money(s.used)} da margem`;
  return `faltam ${money(s.missing)}`;
}

// Antes e depois de pausar, na mesma régua do número do topo.
export function pauseEffect(c: CopilotWire, money: Money): { now: string; paused: string } | null {
  const plan = c.goal?.plan;
  if (!plan || BigInt(plan.remaining) <= 0n) return null;
  const livre = BigInt(c.livre);
  const margin = BigInt(c.margin);
  return {
    now: statusText(moneyStatus({ livre, margin }), money),
    paused: statusText(moneyStatus({ livre: livre + BigInt(plan.remaining), margin }), money),
  };
}
