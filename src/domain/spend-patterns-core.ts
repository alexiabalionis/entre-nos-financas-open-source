// Base comum dos padrões de gasto (puro): tipos, tabela de limites, hora de
// Brasília, contexto do período e helpers de recorte. Sem banco e sem Date
// local. Dinheiro de entrada em bigint centavos; as contas internas usam number
// (centavos cabem com folga) e a saída volta a bigint truncado ao real.
import { addDays } from "./day.ts";
import type { PatternTrace } from "./spend-patterns-trace.ts";

export type TimeQuality = "insuficiente" | "sem_hora" | "com_hora";
export type Payment = "credito" | "pix" | "debito";
export type PurchaseType = "avulso" | "fixa" | "parcela" | "agendado";
export type Recorte = "casa" | "categoria" | "etiqueta" | "conta" | "lugar" | "pagamento";
export type AnalysisId =
  | "concentracao_tempo"
  | "tendencia"
  | "lugares"
  | "compras_pequenas"
  | "recorrencia_escondida"
  | "ritmo_salario"
  | "comprometimento"
  | "dias_fora_da_curva"
  | "forma_pagamento";
export type LeverKind =
  | "uma_a_menos_por_semana"
  | "corte_no_pico"
  | "voltar_ao_nivel_anterior"
  | "cancelar_recorrencia"
  | "compras_pequenas_pela_metade";

export type Purchase = {
  id?: string; // id da linha de origem, só para o rastreio de diagnóstico
  date: string; // 'YYYY-MM-DD'
  at?: string | null; // ISO com fuso (transaction_at)
  cents: bigint; // positivo = gasto
  label: string;
  category: string;
  tag: string;
  account: string;
  card?: string;
  payment: Payment;
  type: PurchaseType;
  essential: boolean;
  installmentStart?: boolean;
};

export type PatternInput = {
  purchases: readonly Purchase[];
  accountsTime: Readonly<Record<string, TimeQuality>>;
  salaryDates: readonly string[];
  months: readonly string[]; // 'YYYY-MM', fechados e contíguos
  incomeAvgCents?: bigint | null; // renda média mensal (análise 7)
  maxDestaques?: number;
  trace?: PatternTrace; // diagnóstico: só registra, não muda o resultado
};

export type Lever = { tipo: LeverKind; cents: bigint };
/**
 * O que em_jogo_cents mede (o valor não mudou; isto só diz o que ele é):
 *  - alavanca: a maior alavanca, dinheiro que uma mudança de rotina pode devolver;
 *  - diferenca_historica: diferença entre o recente e o anterior (ou contra o esperado), não economia;
 *  - movimentado: dinheiro que passa pelo recorte por mês, não economia;
 *  - nenhum: sem alavanca e sem valor próprio.
 */
export type EmJogoNatureza = "alavanca" | "diferenca_historica" | "movimentado" | "nenhum";
// Recortes que dizem COMO se paga, não O QUE se compra: o gasto pode só mudar de lugar, então não há alavanca.
const NO_LEVER: readonly Recorte[] = ["pagamento", "conta"];
const NATUREZA: Partial<Record<AnalysisId, EmJogoNatureza>> = {
  tendencia: "diferenca_historica",
  ritmo_salario: "diferenca_historica",
  dias_fora_da_curva: "diferenca_historica",
  lugares: "movimentado",
  comprometimento: "movimentado",
  forma_pagamento: "movimentado",
};
export type Highlight = {
  analise: AnalysisId;
  recorte: { tipo: Recorte; chave: string };
  corte: string;
  base: { corte_compras: number; corte_cents: bigint; recorte_compras: number; recorte_cents: bigint };
  // Índice (ou parte, em lugares/ritmo/picos); null quando a análise não tem.
  indice: number | null;
  // A mesma métrica na metade anterior e na recente (tendência: centavos/mês).
  metades: readonly [number, number] | null;
  alavancas: Lever[];
  em_jogo_cents: bigint;
  em_jogo_natureza: EmJogoNatureza;
  // Ids das compras do corte: rastreio e investigar_gastos; nunca vão ao modelo.
  ids?: readonly string[];
};

export type Found = { found: Highlight[]; evaluated: number };

export const LIMITS = {
  minRecorteCompras: 12,
  minCorteCompras: 5,
  minCelulaDiaHora: 8,
  indiceMin: 1.5,
  indiceMetade: 1.2,
  tendenciaMin: 0.25,
  topLugares: 3,
  topLugaresMin: 0.6,
  minLugaresDistintos: 4,
  pequenaCents: 3000,
  pequenasMensalMinCents: 10000,
  recorrenciaTolerancia: 0.1,
  recorrenciaMensalDias: [25, 35],
  recorrenciaSemanalDias: [6, 8],
  recorrenciaMinOcorrencias: 3,
  recorrenciaMinPorMetade: 2,
  picoMultiplo: 3,
  picosMin: 5,
  picoDiaSemanaMin: 0.6,
  comprometimentoMin: 0.4,
  parcelasNovasPorMes: 2,
  pagamentoMudancaMin: 0.15,
  comprasPorSemanaAlavanca: 1.5,
  coberturaHoraMin: 0.5,
  horaMinTransacoes: 20,
  horaMesmoHorario: 0.8,
  diasAposSalario: 7,
  maxDestaques: 8,
} as const;

const BRASILIA_OFFSET_MS = 3 * 3_600_000;

// Brasília está em UTC-3 o ano todo (sem horário de verão desde 2019).
export function brasiliaOf(iso: string): { day: string; hour: number; minute: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const s = new Date(ms - BRASILIA_OFFSET_MS).toISOString();
  return { day: s.slice(0, 10), hour: Number(s.slice(11, 13)), minute: Number(s.slice(14, 16)) };
}

export function timeQuality(times: readonly (string | null | undefined)[]): TimeQuality {
  const clock = new Map<string, number>();
  let total = 0;
  for (const t of times) {
    const b = t ? brasiliaOf(t) : null;
    if (!b) continue;
    total++;
    const key = `${b.hour}:${b.minute}`;
    clock.set(key, (clock.get(key) ?? 0) + 1);
  }
  if (total < LIMITS.horaMinTransacoes) return "insuficiente";
  return Math.max(...clock.values()) / total >= LIMITS.horaMesmoHorario ? "sem_hora" : "com_hora";
}

export type Item = { day: string; hour: number | null; cents: number; month: string; half: 0 | 1; p: Purchase };
export type Ctx = {
  items: Item[]; // todas as compras no período
  avulso: Item[]; // só avulsas (análises de comportamento)
  nMonths: number;
  days: [string[], string[]]; // dias de cada metade
  allDays: string[];
  hourEnabled: boolean;
  cobertura: number;
  salaryDates: string[];
  income: number | null;
  from: string;
  to: string;
  trace?: PatternTrace;
};

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
}

export function listDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function buildContext(input: PatternInput): Ctx {
  const months = [...input.months].sort();
  const nOlder = Math.floor(months.length / 2);
  const halfOf = new Map(months.map((m, i) => [m, i < nOlder ? 0 : 1] as const));
  const items: Item[] = [];
  for (const p of input.purchases) {
    const cents = Number(p.cents);
    if (cents <= 0) continue;
    const real = p.at && input.accountsTime[p.account] === "com_hora" ? brasiliaOf(p.at) : null;
    const day = real?.day ?? p.date;
    const month = day.slice(0, 7);
    const half = halfOf.get(month);
    if (half === undefined) continue;
    items.push({ day, hour: real?.hour ?? null, cents, month, half, p });
  }
  const avulso = items.filter((i) => i.p.type === "avulso");
  const total = sumCents(avulso);
  const cobertura = total > 0 ? sumCents(avulso.filter((i) => i.hour !== null)) / total : 0;
  const from = `${months[0] ?? ""}-01`;
  const to = months.length ? monthEnd(months[months.length - 1]!) : from;
  const mid = months[nOlder - 1];
  const split = mid ? monthEnd(mid) : from;
  const allDays = months.length ? listDays(from, to) : [];
  return {
    items,
    avulso,
    nMonths: months.length,
    days: [allDays.filter((d) => d <= split), allDays.filter((d) => d > split)],
    allDays,
    hourEnabled: cobertura >= LIMITS.coberturaHoraMin,
    cobertura,
    salaryDates: [...new Set(input.salaryDates)].sort(),
    income: input.incomeAvgCents ? Number(input.incomeAvgCents) : null,
    from,
    to,
    ...(input.trace ? { trace: input.trace } : {}),
  };
}

export const sumCents = (items: readonly Item[]): number => items.reduce((s, i) => s + i.cents, 0);

// Centavos -> bigint truncado ao real; negativo vira zero.
export const toReais = (cents: number): bigint => BigInt(Math.max(0, Math.trunc(cents / 100))) * 100n;

const NON_PLACE = ["pix enviado", "pix recebido", "transferência", "transferencia"];
export function placeOf(label: string): string | null {
  const l = label.trim();
  const low = l.toLowerCase();
  return !l || NON_PLACE.some((n) => low.startsWith(n)) ? null : l;
}

export type Group = { tipo: Recorte; chave: string; items: Item[] };

export function groupsOf(items: readonly Item[], kinds: readonly Recorte[]): Group[] {
  const out = new Map<string, Group>();
  for (const it of items) {
    for (const tipo of kinds) {
      const p = it.p;
      const chave =
        tipo === "casa" ? "casa"
        : tipo === "categoria" ? p.category
        : tipo === "etiqueta" ? `${p.category} / ${p.tag}`
        : tipo === "conta" ? (p.card ?? p.account)
        : tipo === "lugar" ? placeOf(p.label)
        : p.payment;
      if (chave === null) continue;
      const k = `${tipo}\u0000${chave}`;
      const g = out.get(k) ?? { tipo, chave, items: [] };
      g.items.push(it);
      out.set(k, g);
    }
  }
  return [...out.values()];
}

export const byHalf = (items: readonly Item[], half: 0 | 1): Item[] => items.filter((i) => i.half === half);

export function makeHighlight(
  analise: AnalysisId,
  group: { tipo: Recorte; chave: string; items: readonly Item[] },
  corte: string,
  cut: readonly Item[],
  extra: { indice: number | null; metades: readonly [number, number] | null; alavancas: Lever[]; emJogo?: number },
): Highlight {
  const alavancas = NO_LEVER.includes(group.tipo) ? [] : extra.alavancas.filter((l) => l.cents > 0n);
  const lever = Math.max(0, ...alavancas.map((l) => Number(l.cents)));
  const emJogo = toReais(extra.emJogo ?? lever);
  const natureza: EmJogoNatureza =
    extra.emJogo !== undefined ? (NATUREZA[analise] ?? "diferenca_historica") : emJogo > 0n ? "alavanca" : "nenhum";
  return {
    analise,
    recorte: { tipo: group.tipo, chave: group.chave },
    corte,
    base: {
      corte_compras: cut.length,
      corte_cents: BigInt(sumCents(cut)),
      recorte_compras: group.items.length,
      recorte_cents: BigInt(sumCents(group.items)),
    },
    indice: extra.indice,
    metades: extra.metades,
    alavancas,
    em_jogo_cents: emJogo,
    em_jogo_natureza: natureza,
    ids: cut.flatMap((i) => (i.p.id ? [i.p.id] : [])),
  };
}

// Valor médio por compra x 52 / 12, para recortes com 1,5 compra por semana ou mais.
export function umaAMenos(group: readonly Item[], ctx: Ctx): Lever[] {
  const weeks = ctx.allDays.length / 7;
  if (!group.length || group.length / weeks < LIMITS.comprasPorSemanaAlavanca) return [];
  return [{ tipo: "uma_a_menos_por_semana", cents: toReais(((sumCents(group) / group.length) * 52) / 12) }];
}
