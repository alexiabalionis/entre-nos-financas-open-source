// O veredito do Simular em palavras: "Cabe.", "Fica apertado." ou "Não cabe.",
// e uma frase com o porquê. Não calcula nada novo: lê o nível que o motor já
// decide (`viability`: ok / apertado / inviavel) e o mês de menor folga do
// rascunho. Sem React, para ser testado.
import { monthLong, monthShort, type FutureResult, type SobraHistory } from "../../src/domain/future-months.ts";
import { roomFor, shortMonths } from "../../src/domain/sobra.ts";
import { formatCents } from "../lib/cents.ts";

export type VerdictLevel = "ok" | "apertado" | "inviavel";

/** Pedaço da frase: texto ou um valor em centavos (a tela anima e formata o valor). */
export type Part = string | { cents: bigint };

export type Verdict = {
  level: VerdictLevel;
  /** A palavra grande: "Cabe." / "Fica apertado." / "Não cabe." */
  word: string;
  /** O porquê, em uma ou duas frases (texto pronto, já com valores formatados). */
  line: string;
  /** A mesma frase em pedaços, para a tela animar só os valores. */
  parts: Part[];
  /** Aviso honesto quando o plano já estava assim antes da mudança. */
  before?: string;
};

const WORD: Record<VerdictLevel, string> = {
  ok: "Cabe.",
  apertado: "Fica apertado.",
  inviavel: "Não cabe.",
};

/** O mês de menor folga no horizonte (o primeiro, em empate). */
export function tightestMonth(result: FutureResult, months: number): { month: string; free: bigint } | null {
  const rows = result.rows.slice(0, months);
  if (rows.length === 0) return null;
  let low = rows[0];
  for (const r of rows) if (r.free < low.free) low = r;
  return { month: low.month, free: low.free };
}

/** Junta os pedaços em texto, com os valores formatados (ou •••• com valores ocultos). */
export function partsText(parts: Part[], hidden = false): string {
  return parts.map((p) => (typeof p === "string" ? p : formatCents(p.cents, hidden))).join("");
}

/** "No mês mais apertado, dezembro, ainda sobram R$ 7.369." em pedaços. */
export function tightestParts(result: FutureResult, months: number): Part[] {
  const t = tightestMonth(result, months);
  if (!t) return [];
  // No mesmo ano do primeiro mês, só o nome ("dezembro"); em outro ano, com o ano.
  const full = monthLong(t.month);
  const month = t.month.slice(0, 4) === result.rows[0].month.slice(0, 4) ? full.split(" de ")[0] : full;
  return t.free >= 0n
    ? [`No mês mais apertado, ${month}, ainda sobram `, { cents: t.free }, "."]
    : [`Em ${month} faltam `, { cents: -t.free }, ", que sairiam do saldo em conta."];
}

export function tightestLine(result: FutureResult, months: number, hidden = false): string {
  return partsText(tightestParts(result, months), hidden);
}

/**
 * Veredito do rascunho. `lead` é a frase própria da pergunta (ex.: "A fatura
 * sobe R$ 300 por 10 meses."); o resto vem do motor. Se o plano salvo já tinha
 * o mesmo nível ou pior, diz isso, para a mudança não levar a culpa.
 */
export function verdictOf(
  base: FutureResult,
  draft: FutureResult,
  months: number,
  lead: Part[] | string,
  hidden = false,
  /** Compromisso novo por mês contra o histórico; sem ele, só o plano decide. */
  history?: { commit: bigint; history: History; planned: bigint },
): Verdict {
  const rank = { ok: 0, apertado: 1, inviavel: 2 } as const;
  const plan = draft.viability.level;
  const hist = history ? historyCheck(history.commit, history.history, history.planned) : null;
  // O pior dos dois vence: o plano pega conta negativa; o histórico pega o dia a dia.
  const level: VerdictLevel = hist && rank[hist.level] > rank[plan] ? hist.level : plan;
  const head: Part[] = typeof lead === "string" ? (lead ? [lead] : []) : lead;
  const planWhy: Part[] = plan === "ok" ? [] : [`${draft.viability.title}. ${draft.viability.detail}`];
  const why: Part[] = hist
    ? [...hist.parts, ...(planWhy.length ? [" ", ...planWhy] : [])]
    : plan === "ok"
      ? tightestParts(draft, months)
      : planWhy;
  const parts: Part[] = head.length && why.length ? [...head, " ", ...why] : [...head, ...why];
  const verdict: Verdict = { level, word: WORD[level], line: partsText(parts, hidden), parts };
  if (level !== "ok" && level === plan && rank[base.viability.level] >= rank[level])
    verdict.before = "O plano de vocês já estava assim antes desta mudança.";
  return verdict;
}

/** "A fatura sobe R$ 300 por 10 meses." Parcela arredondada para cima no real
 * inteiro, a mesma conta do rótulo das parcelas (installmentLabel). */
export function purchaseParts(totalCents: bigint, installments: number): Part[] {
  const n = BigInt(installments);
  const each = ((totalCents + n * 100n - 1n) / (n * 100n)) * 100n;
  return installments === 1
    ? ["A fatura do mês sobe ", { cents: totalCents }, "."]
    : ["A fatura sobe ", { cents: each }, ` por ${installments} meses.`];
}

export function purchaseLead(totalCents: bigint, installments: number, hidden = false): string {
  return partsText(purchaseParts(totalCents, installments), hidden);
}

/** Uma sugestão escondida com "agora não": id e o número principal de quando foi escondida. */
export type Dismissed = { id: string; metric: bigint | null };

/**
 * A sugestão segue escondida enquanto a situação não muda: volta quando o
 * número principal dela (diferença, excesso, o que falta) muda 20% ou mais,
 * para cima ou para baixo. Sem número guardado, segue escondida.
 */
export function stillDismissed(metric: bigint | undefined, saved: Dismissed | undefined): boolean {
  if (!saved) return false;
  if (saved.metric === null || metric === undefined) return true;
  const base = saved.metric < 0n ? -saved.metric : saved.metric;
  if (base === 0n) return metric === 0n;
  const delta = metric - saved.metric;
  return (delta < 0n ? -delta : delta) * 5n < base;
}

/**
 * O que costuma sobrar, pelo histórico (mesma fonte e janela do Panorama: os
 * meses fechados dos últimos 12). `kept` = entrou − saiu de cada mês fechado;
 * `avg` = a média (o "Sobra por mês" do Panorama).
 */
export type History = SobraHistory;

/**
 * Veredito pelo histórico (decisão da pessoa, 19/11/2026: o histórico decide,
 * porque o plano não projeta o dia a dia e superestima a folga). O espaço para
 * algo novo é a sobra média menos os aportes que já estão no plano (eles
 * já moram dentro da sobra). Compromisso novo:
 * - acima do espaço → inviável;
 * - dentro do espaço, mas houve mês fechado em que sobrou menos que isso → apertado;
 * - coube em todo mês fechado → ok.
 */
export function historyCheck(
  commit: bigint,
  history: History,
  planned: bigint,
): { level: VerdictLevel; parts: Part[] } {
  const room = roomFor(history, planned);
  const plannedNote: Part[] = planned > 0n ? [" (já descontados ", { cents: planned }, " de aportes do plano)"] : [];
  if (commit > room)
    return {
      level: "inviavel",
      parts: room > 0n
        ? ["É mais que os ", { cents: room }, " que costumam sobrar por mês", ...plannedNote, "."]
        : ["Pelo histórico, não costuma sobrar nada por mês", ...plannedNote, "."],
    };
  const short = shortMonths(history, planned, commit);
  const share = room > 0n ? Number((commit * 100n) / room) : 100;
  const usage: Part[] = ["Costumam sobrar ", { cents: room }, " por mês", ...plannedNote, `: isso usa ${share}% da sobra.`];
  if (short.length > 0)
    return {
      level: "apertado",
      parts: [
        ...usage,
        ` Em ${short.length} dos ${history.kept.length} meses fechados (${short.map((m) => monthShort(m).split("/")[0]).join(", ")}), sobrou menos que isso.`,
      ],
    };
  return { level: "ok", parts: usage };
}
