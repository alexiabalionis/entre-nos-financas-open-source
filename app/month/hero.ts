// Decide QUAL dos 4 estados do herói da tela Mês mostrar (futuro / com número
// / sem número calculável / sem projeção) e devolve os dados prontos pra UM
// <StatBanner>. Sem React: o valor em dinheiro vira centavos (o componente
// anima via countUpMoney), nunca ReactNode. Extraído de month-screen.tsx
// (Etapa 1): eram 4 blocos `<StatBanner inverted>` quase idênticos.
import type { Currency } from "../../src/domain/finance.ts";
import type { Tone } from "../ds/shared.ts";
import type { MonthAnalysis } from "../month-analysis.ts";
import { pendingGaps, type ProjectionView } from "../projection-view.ts";
import { CONFIDENCE_WORD, SCENARIO_WORD, confidenceTone, gapSentence, lowDayCaption } from "./copy.ts";
import { ddmm } from "./format.ts";

export type HeroSpec = {
  eyebrow: string;
  /** Centavos a animar (countUpMoney fica no componente); null quando o valor
   *  exibido é texto (valueText). */
  valueCents: string | null;
  /** Texto do valor quando valueCents é null. Ignorado quando valueCents
   *  estiver preenchido. */
  valueText: string;
  title: boolean;
  neg: boolean;
  caption: string;
  tone: Tone;
  toneLabel: string;
  /** Ressalva da projeção (null fora dos casos de projeção, ou sem nenhuma
   *  lacuna pendente). */
  reason: { prefix: string; sentence: string; extraCount: number } | null;
};

function reasonFor(
  pv: ProjectionView,
  currency: Currency,
  hidden: boolean,
): HeroSpec["reason"] {
  const pending = pendingGaps(pv.gaps);
  if (pending.length === 0) return null;
  return {
    prefix: pv.hero.state === "COM_RESSALVA" ? "Ressalva:" : "Por quê:",
    sentence: gapSentence(pending[0], pv.start.date, currency, hidden),
    extraCount: pending.length - 1,
  };
}

export function heroProps(input: {
  pv: ProjectionView | null;
  isFuture: boolean;
  month: string;
  analysis: MonthAnalysis;
  currency: Currency;
  /** "Ocultar valores" ligado: as frases saem com •••• no lugar do dinheiro. */
  hidden?: boolean;
}): HeroSpec {
  const { pv, isFuture, month, analysis: a, currency, hidden = false } = input;

  if (pv && isFuture) {
    // Mês seguinte: só estimativa. O topo mostra o saldo previsto no 1º dia
    // do mês, nunca "Livre até o salário" nem "nesta semana". Sem saldo de
    // partida (startCents null) mostra o estado, sem fabricar 0.
    return {
      eyebrow: `Saldo previsto em ${ddmm(pv.start.date ?? `${month}-01`)}`,
      valueCents: pv.start.cents,
      valueText: "Sem saldo previsto",
      title: false,
      neg: pv.start.cents !== null && BigInt(pv.start.cents) < 0n,
      caption: lowDayCaption(pv.hero.low, currency, hidden),
      tone: confidenceTone(pv.hero.state),
      toneLabel: CONFIDENCE_WORD[pv.hero.state],
      reason: reasonFor(pv, currency, hidden),
    };
  }

  if (pv && pv.hero.availableCents !== null) {
    // Há número de "quanto dá pra gastar" (COM_RESSALVA/CONFIRMADO): mostra
    // o valor com o rótulo "Livre até DD/MM" (fim do horizonte).
    return {
      eyebrow: `Livre até ${ddmm(pv.hero.horizonEnd)}`,
      valueCents: pv.hero.availableCents,
      valueText: "",
      title: false,
      neg: false,
      caption: lowDayCaption(pv.hero.low, currency, hidden),
      tone: confidenceTone(pv.hero.state),
      toneLabel: CONFIDENCE_WORD[pv.hero.state],
      reason: reasonFor(pv, currency, hidden),
    };
  }

  if (pv) {
    // Sem número calculável (INDETERMINADO/SEM_FOLGA/DEPENDE_DE_DADOS):
    // mantém a palavra do estado como título, sem inventar um valor.
    return {
      eyebrow: "Seu mês até o salário",
      valueCents: null,
      valueText: CONFIDENCE_WORD[pv.hero.state],
      title: true,
      neg: false,
      caption: lowDayCaption(pv.hero.low, currency, hidden),
      tone: confidenceTone(pv.hero.state),
      toneLabel: CONFIDENCE_WORD[pv.hero.state],
      reason: reasonFor(pv, currency, hidden),
    };
  }

  // Sem projeção: herói pelo modelo de itens (fallback até o F1 ligar a rota).
  const weekAvailable = a.weekAvailable;
  const valueCents =
    weekAvailable !== null ? weekAvailable : a.scenario === "encerrado" ? a.leftover : null;
  const valueText =
    weekAvailable !== null
      ? ""
      : a.scenario === "futuro"
        ? "Ainda não começou"
        : a.scenario === "encerrado"
          ? ""
          : "Informe os valores";
  return {
    eyebrow: "Disponível nesta semana",
    valueCents,
    valueText,
    title: weekAvailable === null,
    neg: a.scenario === "encerrado" && BigInt(a.leftover) < 0n,
    caption:
      a.scenario === "futuro"
        ? "Este mês ainda não tem planejamento."
        : a.scenario === "insuficiente"
          ? "Preencha os valores em aberto para a gente projetar."
          : "Fatia da sobra prevista proporcional aos dias que faltam.",
    tone: a.tone,
    toneLabel: SCENARIO_WORD[a.scenario],
    reason: null,
  };
}
