// Copy e tom semântico da tela Mês: strings e decisões de tom, byte a byte
// iguais ao que month-screen.tsx tinha espalhado em 4 lugares. Sem React.
// Extraído de month-screen.tsx (Etapa 1).
import type { Currency } from "../../src/domain/finance.ts";
import { money } from "../lib/money.ts";
import type { GapKind, PendingGap } from "../projection-view.ts";
import type { MonthAnalysis } from "../month-analysis.ts";
import type { Tone } from "../ds/shared.ts";
import { ddmm } from "./format.ts";

/** Palavra de status do herói por cenário (copy do protótipo final). */
export const SCENARIO_WORD: Record<MonthAnalysis["scenario"], string> = {
  positivo: "Dentro do plano",
  risco: "Exige atenção",
  insuficiente: "Dados incompletos",
  futuro: "Estimativa",
  encerrado: "Realizado",
};

/** Copy e tom do DS por estado de confiança da PROJEÇÃO (motor F0d). Enquadrado
 *  pela intenção do cliente, sem jargão técnico. */
export const CONFIDENCE_WORD: Record<
  "CONFIRMADO" | "COM_RESSALVA" | "DEPENDE_DE_DADOS" | "SEM_FOLGA" | "INDETERMINADO",
  string
> = {
  CONFIRMADO: "Confiável",
  COM_RESSALVA: "Com ressalva",
  DEPENDE_DE_DADOS: "Faltam dados",
  SEM_FOLGA: "Sem folga",
  INDETERMINADO: "Indeterminado",
};

export function confidenceTone(state: keyof typeof CONFIDENCE_WORD): Tone {
  switch (state) {
    case "CONFIRMADO":
      return "ok";
    case "SEM_FOLGA":
      return "danger";
    case "INDETERMINADO":
      return "neutral";
    default:
      return "warn";
  }
}

/** Copy de "Precisa de você" por tipo de lacuna, pela intenção do cliente. */
export const GAP_TITLE: Record<Exclude<GapKind, "other">, string> = {
  income: "Conte quando o salário entra",
  "stale-balance": "Atualize o saldo das contas",
  bill: "Confira o valor da fatura",
};

/** Destino de cada lacuna: onde a pessoa resolve a pendência. "other" não tem
 *  lugar certo, então fica sem link. */
export function gapHref(kind: GapKind): string | undefined {
  switch (kind) {
    case "stale-balance":
    case "income":
      return "/espaco?painel=banks";
    case "bill":
      return "/";
    case "other":
      return undefined;
  }
}

/** "No pior dia (DD/MM), o saldo chega a R$ X." — mesma frase repetida 3x nos
 *  estados de StatBanner da projeção. */
export function lowDayCaption(
  low: { day: string; cents: string },
  currency: Currency,
  hidden = false,
): string {
  return `No pior dia (${ddmm(low.day)}), o saldo chega a ${money(low.cents, currency, hidden)}.`;
}

/** Frase da ressalva no topo: diz POR QUE o número tem ressalva, a partir da
 *  lacuna de maior peso (as mesmas de "Precisa de você"). */
export function gapSentence(
  g: PendingGap,
  snapshotDate: string | null,
  currency: Currency,
  hidden = false,
): string {
  const amount =
    g.impactCents === "unbounded" ? null : money(g.impactCents, currency, hidden);
  switch (g.kind) {
    case "stale-balance":
      return snapshotDate
        ? `O saldo das contas é de ${ddmm(snapshotDate)}. Até a próxima leitura, descontamos ${amount} de gasto estimado.`
        : `O saldo das contas pode estar desatualizado. Descontamos ${amount} de gasto estimado.`;
    case "income":
      return "Ainda não sabemos quando o salário entra.";
    case "bill":
      return `Uma fatura ainda não fechou. O valor é estimado e pode mudar ${amount}.`;
    default:
      return g.reason || "Um dos valores ainda é estimado.";
  }
}
