import type { ProjectionResult, Day, DayPoint } from "../src/domain/projection.ts";
import type {
  ReconciledFlow,
  Quality,
} from "../src/domain/projection-reconcile-shared.ts";
import type {
  ConfidenceResult,
  ConfidenceState,
  Gap,
} from "../src/domain/projection-confidence.ts";
import type { ProjectionMonthWire } from "../src/server/projection.ts";
import { flowCategory, NO_CATEGORY_LABEL } from "./month/palette.ts";

// View-model PURO da tela Mês: adapta o resultado do motor de caixa
// (ConfidenceResult + fluxos conciliados) numa estrutura pronta pra renderizar,
// sem React/DOM/I/O. Determinística: `today` entra por parâmetro, nada de
// Date.now. Dinheiro SEMPRE como string de centavos (BigInt.toString()), nunca
// number; datas Day cruas. Não formata moeda nem data — isso é da camada visual.

export type ProjectionViewInput = {
  confidence: ConfidenceResult;
  flows: readonly ReconciledFlow[];
  today: Day;
  currency: "BRL" | "USD" | "EUR";
};

export type ProjectionView = {
  hero: {
    // null quando a capacidade de gasto (cCons) não está disponível na fonte —
    // o F1a do coletor (src/server/projection.ts) deliberadamente não a expõe
    // ainda. O chamador deve mostrar um estado explícito de indisponível, NUNCA
    // fabricar "0" (vira alarme falso de "sem espaço").
    availableCents: string | null;
    // Data do próximo salário/recebimento (Day cru), para o rótulo "Livre até o
    // salário (DD/MM)". null quando não há recebimento futuro conhecido.
    nextIncomeDate: string | null;
    // Fim do horizonte (Day cru): rótulo "Livre até DD/MM". O número do topo é o
    // menor saldo da janela inteira, que termina aqui.
    horizonEnd: Day;
    state: ConfidenceState;
    low: { day: Day; cents: string };
  };
  flow: {
    firmCents: string;
    estimatedCents: string;
    incomingCents: string;
  };
  upcoming: {
    key: string;
    date: Day;
    label: string;
    cents: string;
    direction: "in" | "out";
    quality: Quality;
    category: string | null;
  }[];
  // Saídas agrupadas por categoria (summarizeCategories), maior primeiro.
  categories: { label: string; cents: string }[];
  path: { day: Day; cents: string }[];
  gaps: { key: string; reason: string; impactCents: string | "unbounded" }[];
  // Saldo de partida da projeção (sConf) e a data do retrato do saldo. date
  // null quando a fonte não informa (ex.: toProjectionView, só em teste).
  start: { cents: string | null; date: Day | null };
  // Só no mês atual: saldo por conta (soma = start.cents), o que sai até o fim
  // do horizonte (véspera do pagamento) e as datas para contar os dias.
  cash: {
    today: Day;
    payDate: Day | null;
    accounts: { id: string; name: string; cents: string; date: Day | null }[];
    scheduledOutCents: string;
  } | null;
  // Primeiro dia em que o saldo conservador fica negativo e quanto falta.
  deficit: { cents: string; day: Day } | null;
};

export type GapKind = "income" | "stale-balance" | "bill" | "other";
export type PendingGap = {
  key: string;
  kind: GapKind;
  reason: string;
  impactCents: string | "unbounded";
};

function gapKind(key: string): GapKind {
  if (key.startsWith("income:")) return "income";
  if (key.startsWith("stale:saldo")) return "stale-balance";
  if (key.startsWith("bill:")) return "bill";
  return "other";
}

// "Precisa de você": só as lacunas que mexem no número (impacto 0 não pede
// ação), com impacto indeterminado primeiro e depois o maior impacto. Não muta.
export function pendingGaps(
  gaps: ProjectionView["gaps"],
): PendingGap[] {
  return gaps
    .filter((g) => g.impactCents === "unbounded" || BigInt(g.impactCents) !== 0n)
    .map((g) => ({ ...g, kind: gapKind(g.key) }))
    .sort((a, b) => {
      if (a.impactCents === "unbounded") return b.impactCents === "unbounded" ? 0 : -1;
      if (b.impactCents === "unbounded") return 1;
      const d = BigInt(b.impactCents) - BigInt(a.impactCents);
      return d > 0n ? 1 : d < 0n ? -1 : 0;
    });
}

// Qualidades que compõem cada balde do resumo de fluxo (saídas). FIRM = a
// pagar com valor certo (fatura fechada/agendado/planejado/estrutural); não há
// "já saiu" — o pago já está no saldo e nem entra na projeção.
const FIRM = new Set<Quality>([
  "confirmed",
  "scheduled",
  "planned",
  "structural",
]);
const ESTIMATED = new Set<Quality>(["estimated", "inconsistent"]);

// Forma mínima de fluxo que as somas/baldes abaixo precisam: serve tanto o
// ReconciledFlow de domínio (cons.cents: bigint) quanto o ProjectionFlowWire
// que atravessa o fio (cons.cents: string) — mesma lógica, sem duplicar.
type FlowLike = {
  key: string;
  direction: "in" | "out";
  quality: Quality;
  cons: { date: Day; cents: bigint | string };
  explain: string;
  // Só no fio (ProjectionFlowWire): nome legível e categoria resolvidos pelo
  // coletor. O fluxo de domínio não tem; aí o label cai no explain.
  label?: string;
  category?: string | null;
};

// Mesma regra do motor (landingDay em src/domain/projection.ts): fluxo com data
// conservadora depois de horizonEnd não entra na projeção, então também não
// entra nas somas nem nas listas da tela. Vencido continua (cai em today).
export function withinHorizon<T extends FlowLike>(
  flows: readonly T[],
  horizonEnd: Day,
): T[] {
  return flows.filter((f) => f.cons.date <= horizonEnd);
}

// Recorte mensal: fluxos cuja data conservadora cai em [start, end] (inclusive),
// igual ao filtro do servidor em modo future. Não muta.
export function inMonth<T extends FlowLike>(
  flows: readonly T[],
  start: Day,
  end: Day,
): T[] {
  return flows.filter((f) => f.cons.date >= start && f.cons.date <= end);
}

// Composição das saídas por categoria, maior primeiro. Fatura de cartão vem
// sem categoria do coletor e vira "Cartões"; o resto sem categoria vira
// "Sem categoria". Não muta.
export function summarizeCategories<T extends FlowLike>(
  flows: readonly T[],
): { label: string; cents: string }[] {
  const byLabel = new Map<string, bigint>();
  for (const f of flows) {
    if (f.direction !== "out") continue;
    const label = flowCategory(f) ?? NO_CATEGORY_LABEL;
    byLabel.set(label, (byLabel.get(label) ?? 0n) + BigInt(f.cons.cents));
  }
  return [...byLabel.entries()]
    .filter(([, cents]) => cents > 0n)
    .sort(([la, a], [lb, b]) => (a === b ? la.localeCompare(lb) : a > b ? -1 : 1))
    .map(([label, cents]) => ({ label, cents: cents.toString() }));
}

// Soma em BigInt o cents conservador (cons) dos fluxos que satisfazem o filtro.
// Aceita cents em bigint (domínio) ou string (fio): BigInt() normaliza os dois.
function sumBy<T extends FlowLike>(
  flows: readonly T[],
  keep: (flow: T) => boolean,
): string {
  let total = 0n;
  for (const flow of flows) if (keep(flow)) total += BigInt(flow.cons.cents);
  return total.toString();
}

// Resumo "Seu mês": a pagar (firme) / estimado / entradas. Extraído para ser
// reusado tanto por toProjectionView (ConfidenceResult completo, com cCons)
// quanto por quem só tem o retrato do F1a (sem cCons) e precisa dos mesmos 4
// baldes a partir dos mesmos fluxos — nunca reimplementar esta soma.
export function summarizeFlowBuckets<T extends FlowLike>(
  flows: readonly T[],
): {
  firmCents: string;
  estimatedCents: string;
  incomingCents: string;
} {
  return {
    firmCents: sumBy(
      flows,
      (f) => f.direction === "out" && FIRM.has(f.quality),
    ),
    estimatedCents: sumBy(
      flows,
      (f) => f.direction === "out" && ESTIMATED.has(f.quality),
    ),
    incomingCents: sumBy(flows, (f) => f.direction === "in"),
  };
}

// "O que vem": TODOS os fluxos em aberto (nada "já saiu" — o pago já está no
// saldo e nem entra na projeção), ordenados pela data conservadora ascendente.
// Não muta o input (cópia antes do sort). Mesmo motivo de reuso do
// summarizeFlowBuckets acima.
export function summarizeUpcoming<T extends FlowLike>(
  flows: readonly T[],
): {
  key: string;
  date: Day;
  label: string;
  cents: string;
  direction: "in" | "out";
  quality: Quality;
  category: string | null;
}[] {
  return [...flows]
    .sort((a, b) => (a.cons.date < b.cons.date ? -1 : a.cons.date > b.cons.date ? 1 : 0))
    .map((f) => ({
      key: f.key,
      date: f.cons.date,
      label: f.label || f.explain,
      category: f.category ?? null,
      cents: f.cons.cents.toString(),
      direction: f.direction,
      quality: f.quality,
    }));
}

export function toProjectionView(input: ProjectionViewInput): ProjectionView {
  const { confidence, flows } = input;
  const result: ProjectionResult = confidence.result;

  const hero: ProjectionView["hero"] = {
    availableCents: confidence.result.cCons.toString(),
    // ConfidenceResult não carrega a data do salário (derivada no coletor do
    // servidor, não no motor puro); toProjectionView só é usado em teste, então
    // aqui fica null — a tela real recebe nextIncomeDate pelo wire (preview-mes).
    nextIncomeDate: null,
    // O resultado do motor não carrega horizonEnd: o último dia da série é o
    // fim do horizonte (cai em today se a série vier vazia).
    horizonEnd: result.series.at(-1)?.day ?? input.today,
    state: confidence.state,
    low: {
      day: result.low.cons.day,
      cents: result.low.cons.cents.toString(),
    },
  };

  const flow: ProjectionView["flow"] = summarizeFlowBuckets(flows);

  const upcoming: ProjectionView["upcoming"] = summarizeUpcoming(flows);
  // toProjectionView não recebe horizonEnd (ProjectionViewInput); o recorte do
  // horizonte é feito por quem tem o fio (preview-mes, via withinHorizon).

  const path: ProjectionView["path"] = result.series.map((point: DayPoint) => ({
    day: point.day,
    cents: point.cons.toString(),
  }));

  const gaps: ProjectionView["gaps"] = confidence.gaps.map((gap: Gap) => ({
    key: gap.key,
    reason: gap.reason,
    impactCents: gap.impact === "unbounded" ? "unbounded" : gap.impact.toString(),
  }));

  const start: ProjectionView["start"] = {
    cents: result.sConf.toString(),
    date: null,
  };
  const deficit: ProjectionView["deficit"] = result.deficit
    ? { cents: result.deficit.cents.toString(), day: result.deficit.day }
    : null;

  const categories = summarizeCategories(flows);

  return { hero, flow, upcoming, categories, path, gaps, start, cash: null, deficit };
}

export type ProjectionMode = "current" | "future" | "closed" | "unavailable";

// Quais blocos da tela Mês aparecem em cada modo da projeção. current/future
// mostram a projeção inteira; closed mostra tudo também (a tela cai no modelo
// de itens, sem projeção); unavailable só o aviso.
export function visibleBlocks(mode: ProjectionMode): {
  banner: boolean;
  flow: boolean;
  upcoming: boolean;
  gaps: boolean;
  path: boolean;
  notice: boolean;
} {
  const showAll = mode !== "unavailable";
  return {
    banner: showAll,
    flow: showAll,
    upcoming: showAll,
    gaps: showAll,
    path: showAll,
    notice: !showAll,
  };
}

// Converte o retrato do coletor do mês (ProjectionMonthWire, já em
// centavos-string — ver src/server/projection.ts) no ProjectionView que a
// tela consome. Só confia na projeção quando é do mês pedido (evita a velha
// durante o fetch) e o modo é current/future (closed/unavailable não têm
// flows/série no coletor). Extraído de preview-mes/page.tsx (Etapa 1): mesma
// lógica, sem repetir por tela que precisar da projeção de um mês.
export function wireToView(
  wire: ProjectionMonthWire | null,
  month: string,
): ProjectionView | null {
  if (!wire || wire.monthStart !== month + "-01") return null;
  if (wire.mode !== "current" && wire.mode !== "future") return null;

  const horizonFlows = withinHorizon(wire.flows, wire.horizonEnd);
  // Os três resumos (Seu mês, O que vem, Composição) olham só o mês pedido; a
  // curva, o pior dia e o número do topo seguem na janela do horizonte.
  const monthFlows = inMonth(horizonFlows, wire.monthStart, wire.monthEnd);

  return {
    hero: {
      availableCents: wire.shown,
      nextIncomeDate: wire.nextIncomeDate,
      horizonEnd: wire.horizonEnd,
      state: wire.state,
      low: { day: wire.low.cons.day, cents: wire.low.cons.cents },
    },
    flow: summarizeFlowBuckets(monthFlows),
    upcoming: summarizeUpcoming(monthFlows),
    categories: summarizeCategories(monthFlows),
    path: wire.series.map((p) => ({ day: p.day, cents: p.cons })),
    gaps: wire.gaps.map((g) => ({
      key: g.key,
      reason: g.reason,
      impactCents: g.impact,
    })),
    // future: saldo previsto no 1º dia do mês (startCents, pode ser null:
    // nunca fabricamos 0). current: saldo de partida do motor, como antes.
    start:
      wire.mode === "future"
        ? { cents: wire.startCents, date: wire.monthStart }
        : { cents: wire.sConf, date: wire.snapshotDate },
    cash:
      wire.mode === "current"
        ? (() => {
            const out = summarizeFlowBuckets(horizonFlows);
            return {
              today: wire.today,
              payDate: wire.nextIncomeDate,
              accounts: wire.accounts,
              scheduledOutCents: (BigInt(out.firmCents) + BigInt(out.estimatedCents)).toString(),
            };
          })()
        : null,
    deficit: wire.deficit,
  };
}
