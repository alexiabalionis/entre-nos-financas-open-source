import {
  contributionMonths,
  monthLong,
  monthShort,
  neededMonthly,
  type DiffItem,
  type FutureInput,
  type FutureResult,
  type CardPart,
  type FutureRow,
  type Line,
  type Milestone,
} from "../../src/domain/future-months.ts";
import { formatCents, formatReais, formatSignedReais, toReais, maskMoney } from "../lib/cents.ts";
import type { BarLayer, CalcLine, DiffRow, Lane, RailItem } from "../ds/types.ts";
import { cardLayerColor, categoryLayerColor, goalColor, outrasLayerColor } from "./colors.ts";

// Modelos de visualização do Futuro: toda a conta que os componentes precisam,
// pura e testada. Os componentes só chamam estas funções e desenham.

const sumBy = <T>(list: readonly T[], pick: (t: T) => bigint) => list.reduce((s, x) => s + pick(x), 0n);

/** Plano vigente de um objetivo no mês (o último plano com mês <= month; 0 se não há). */
function plannedAt(plans: readonly { month: string; planned: bigint }[], month: string): bigint {
  let best: { month: string; planned: bigint } | null = null;
  for (const p of plans) if (p.month <= month && (!best || p.month > best.month)) best = p;
  return best?.planned ?? 0n;
}

/** Trilhos dos objetivos ativos, na ordem de prioridade. */
export function goalLanes(input: FutureInput, result: FutureResult, months: number, hidden = false): Lane[] {
  const goals = input.goals
    .filter((g) => g.status === "active")
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return goals.map((g, position) => {
    const at = result.reach[g.id] ?? null;
    const idx = at === null ? -1 : result.rows.findIndex((r) => r.month === at);
    const end = idx >= 0 && idx < months ? idx : null;
    const unplanned = result.rows.slice(0, months).every((r) => (r.goalIn[g.id] ?? 0n) === 0n);
    const endLabel =
      g.target === 0n
        ? "sem meta"
        : end === null
          ? unplanned
            ? "sem aporte planejado"
            : "não completa no horizonte"
          : `${formatCents(g.target, hidden)} em ${monthShort(result.rows[end].month)}`;
    return { key: g.id, label: g.name, color: goalColor(position), end, endLabel };
  });
}

/** Marcos agrupados por índice de mês (só os que caem dentro do horizonte). */
export function milestonesByMonth(
  _input: FutureInput,
  result: FutureResult,
  months: number,
): Map<number, Milestone[]> {
  const out = new Map<number, Milestone[]>();
  const rows = result.rows.slice(0, months);
  for (const m of result.milestones) {
    const i = rows.findIndex((r) => r.month === m.month);
    if (i < 0) continue;
    out.set(i, [...(out.get(i) ?? []), m]);
  }
  return out;
}

/** Itens da trilha de meses, com quantos marcos cada mês tem. */
export function railItems(input: FutureInput, result: FutureResult, months: number, hidden = false): RailItem[] {
  const marks = milestonesByMonth(input, result, months);
  return result.rows.slice(0, months).map((row, i) => {
    const list = marks.get(i) ?? [];
    return {
      key: row.month,
      label: monthShort(row.month),
      caption: row.free < 0n ? `faltam ${formatCents(-row.free, hidden)}` : `${formatCents(row.free, hidden)} de folga`,
      marks: list.length,
      tone: row.free < 0n || row.cash.low.cents < 0n ? "danger" : list.some((m) => m.kind === "goal-reached") ? "ok" : undefined,
    };
  });
}

/**
 * A conta do mês. O motor calcula free = (entrada − fixas − dia a dia) − fatura − imprevistos − aportes;
 * "dia a dia" não vem separado na linha, então sai de entrada − fixas − preCard (exato). A soma é
 * conferida em centavos; só depois os valores viram reais para exibir.
 */
export function monthCalc(
  input: FutureInput,
  result: FutureResult,
  index: number,
): { lines: CalcLine[]; total: { label: string; value: number } } {
  const row = result.rows[index];
  if (!row) throw new RangeError(`Mês ${index} fora da projeção.`);
  const income = sumBy(input.income.filter((a) => a.month === row.month), (a) => a.cents);
  const fixed = sumBy(input.fixed.filter((a) => a.month === row.month), (a) => a.cents);
  const everyday = income - fixed - row.preCard;
  const names = new Map(input.goals.map((g) => [g.id, g.name]));
  const goals = Object.entries(row.goalIn).filter(([, c]) => c > 0n);

  // Contas fixas mostra o mês inteiro e abre em já pagas / pendentes. A folga
  // só desconta as pendentes: o saldo de partida já desconta as pagas.
  const paid = sumBy((input.paidFixed ?? []).filter((a) => a.month === row.month), (a) => a.cents);
  const lines: CalcLine[] = [
    { key: "income", label: "Entrada", value: toReais(income), op: "+" },
    { key: "fixed", label: "Contas fixas", value: -toReais(fixed + paid), op: "−" },
  ];
  if (paid > 0n)
    lines.push(
      { key: "fixed-paid", label: "Já pagas", note: "Já saíram do saldo de hoje", value: toReais(paid), nested: true },
      { key: "fixed-open", label: "Pendentes", value: toReais(fixed), nested: true },
    );
  if (everyday > 0n)
    lines.push({ key: "everyday", label: "Dia a dia (média)", value: -toReais(everyday), op: "−", estimate: true });
  lines.push({ key: "card", label: "Fatura do cartão", value: -toReais(row.card), op: "−" });
  if (row.shocks > 0n) lines.push({ key: "shocks", label: "Imprevistos", value: -toReais(row.shocks), op: "−" });
  for (const [id, cents] of goals)
    lines.push({ key: `goal:${id}`, label: `Para ${names.get(id) ?? "objetivo"}`, value: -toReais(cents), op: "−" });

  const sum = income - fixed - everyday - row.card - row.shocks - goals.reduce((s, [, c]) => s + c, 0n);
  if (sum !== row.free)
    throw new Error(
      `A conta de ${row.month} não fecha: linhas somam ${sum} centavos e a folga é ${row.free} (diferença de ${row.free - sum}).`,
    );
  return { lines, total: { label: "Folga do mês", value: toReais(row.free) } };
}

const MAX_CATEGORY_LAYERS = 6;
const VAGUE_CATEGORIES = new Set(["Sem categoria", "Outras despesas"]);

/** Camadas e valores do gráfico da fatura, somando todos os cartões. */
export function cardBars(
  _input: FutureInput,
  result: FutureResult,
  months: number,
  hidden = false,
): {
  columns: string[];
  columnLabels: string[];
  layers: BarLayer[];
  values: number[][];
  footnotes: (string | null)[];
  /** Texto de apoio por coluna/camada: rótulo e valor exato. */
  tooltips: (string | null)[][];
  /** Legenda: uma linha por categoria nomeada, mais uma só pra "Demais categorias" (que no gráfico vem partida em várias camadas, uma por categoria real, sem aparecer aqui uma a uma). */
  legend: BarLayer[];
} {
  const rows = result.rows.slice(0, months);
  // Parcelas e recorrentes agrupados pela categoria da compra (as maiores com
  // nome, o resto em "Demais categorias"). Categoria vaga ("Sem categoria",
  // "Outras despesas") não ganha camada própria: vai direto para "Demais".
  // A compra simulada fica numa camada só dela, por cima, e a estimativa e o
  // valor do banco seguem como estão.
  type Kind = "categoria" | "simulada" | "estimado" | "fatura";
  const categoryOfPart = (p: CardPart) => p.category ?? "Sem categoria";
  const simulated = (p: CardPart) => p.key.startsWith("sim:");
  const categoryTotals = new Map<string, bigint>();
  const categorized = (p: CardPart) =>
    (p.kind === "parcela" || p.kind === "recorrente" || (p.kind === "estimado" && p.category !== undefined)) && !simulated(p) && p.cents > 0n;
  for (const row of rows)
    for (const c of row.cardParts)
      for (const p of c.parts)
        if (categorized(p))
          categoryTotals.set(categoryOfPart(p), (categoryTotals.get(categoryOfPart(p)) ?? 0n) + p.cents);
  const byTotal = [...categoryTotals.entries()].filter(([name]) => !VAGUE_CATEGORIES.has(name)).sort((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1,
  );
  const vague = [...categoryTotals.keys()].some((name) => VAGUE_CATEGORIES.has(name));
  const named = new Set(
    (byTotal.length + (vague ? 1 : 0) <= MAX_CATEGORY_LAYERS ? byTotal : byTotal.slice(0, MAX_CATEGORY_LAYERS - 1)).map(([k]) => k),
  );
  const layerKeys: string[] = [];
  const labels = new Map<string, string>();
  const kinds = new Map<string, Kind>();
  const note = (key: string, label: string, kind: Kind) => {
    if (!labels.has(key)) {
      labels.set(key, label);
      kinds.set(key, kind);
      layerKeys.push(key);
    }
  };
  // "Demais categorias" quebra em uma camada por categoria real (pra poder
  // ver/tocar cada uma na própria barra), mas todas elas viram UMA linha só
  // na legenda — ver `legend` mais abaixo.
  const OUTRAS_PREFIX = "cat:outras:";
  const layerOf = (p: CardPart) => {
    if (simulated(p)) {
      note(`sim:${p.key}`, p.label, "simulada");
      return `sim:${p.key}`;
    }
    if (categorized(p)) {
      const name = categoryOfPart(p);
      const key = named.has(name) ? `cat:${name}` : `${OUTRAS_PREFIX}${name}`;
      note(key, name, "categoria");
      return key;
    }
    const kind = p.kind as "estimado" | "fatura";
    note(kind, kind === "estimado" ? "Outras compras, fatura em aberto" : "Na fatura, sem detalhe (banco)", kind);
    return kind;
  };
  const cents = rows.map(() => new Map<string, bigint>());
  rows.forEach((row, i) => {
    for (const c of row.cardParts) {
      // "Já pago nesta fatura" é negativo: abate das maiores partes do mesmo
      // cartão, para a barra fechar com a fatura (e nunca descer de zero).
      let paid = -c.parts.filter((p) => p.cents < 0n).reduce((s, p) => s + p.cents, 0n);
      const parts = c.parts
        .filter((p) => p.cents > 0n)
        .sort((a, b) => (a.cents === b.cents ? 0 : a.cents > b.cents ? -1 : 1))
        .map((p) => {
          const cut = paid < p.cents ? paid : p.cents;
          paid -= cut;
          return { part: p, cents: p.cents - cut };
        });
      for (const { part, cents: v } of parts) {
        if (v <= 0n) continue;
        const k = layerOf(part);
        cents[i].set(k, (cents[i].get(k) ?? 0n) + v);
      }
    }
  });
  // De baixo para cima: categorias (maior primeiro; dentro de "Demais", suas
  // categorias reais também maior primeiro, por último), estimativa, valor
  // do banco e a compra simulada no topo.
  const outrasByTotal = [...categoryTotals.entries()].filter(([name]) => !named.has(name)).sort((a, b) =>
    a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] > b[1] ? -1 : 1,
  );
  const outrasRank = new Map(outrasByTotal.map(([name], i) => [name, i]));
  const order = { categoria: 0, estimado: 1, fatura: 2, simulada: 3 } as const;
  const rank = (k: string) =>
    k.startsWith(OUTRAS_PREFIX) ? byTotal.length + outrasRank.get(k.slice(OUTRAS_PREFIX.length))! : byTotal.findIndex(([name]) => `cat:${name}` === k);
  const sorted = [...layerKeys].sort(
    (a, b) => order[kinds.get(a)!] - order[kinds.get(b)!] || rank(a) - rank(b),
  );
  // Cor de cada categoria dentro de "Demais" vem de um degradê próprio
  // (outrasLayerColor), não da paleta de categoria nomeada — senão uma delas
  // repetiria a cor de uma categoria de verdade em outro lugar da mesma barra.
  let categoryIndex = 0;
  let outrasIndex = 0;
  const layers: BarLayer[] = sorted.map((k) => {
    const kind = kinds.get(k)!;
    return {
      key: k,
      label: labels.get(k)!,
      color:
        kind === "categoria"
          ? k.startsWith(OUTRAS_PREFIX)
            ? outrasLayerColor(outrasIndex++)
            : categoryLayerColor(categoryIndex++)
          : kind === "simulada"
            ? cardLayerColor("pontual")
            : cardLayerColor(kind),
      ...(kind === "estimado" ? { estimate: true } : {}),
    };
  });
  // Legenda: uma linha por categoria nomeada, e UMA SÓ pra todas as camadas
  // "Demais categorias" (a quebra por categoria real e seu degradê de cor
  // ficam só nas barras/tooltip) — o selo da legenda usa a cor base do grupo.
  const legendSeen = new Set<string>();
  const legend: BarLayer[] = [];
  for (const l of layers) {
    const key = l.key.startsWith(OUTRAS_PREFIX) ? "cat:outras" : l.key;
    if (legendSeen.has(key)) continue;
    legendSeen.add(key);
    legend.push(key === "cat:outras" ? { key, label: "Demais categorias", color: cardLayerColor("recorrente") } : l);
  }
  const values = rows.map((_, i) => sorted.map((k) => toReais(cents[i].get(k) ?? 0n)));
  // Cada camada arredonda sozinha; a diferença vai para a maior, para o topo
  // da barra bater com a fatura em reais (R$ 8.535, não R$ 8.536).
  values.forEach((col, i) => {
    const positive = sumBy([...cents[i].values()], (c) => c);
    const diff = toReais(positive) - col.reduce((a, b) => a + b, 0);
    if (diff !== 0 && col.length) {
      const big = col.indexOf(Math.max(...col));
      col[big] += diff;
    }
  });
  // Tooltip por coluna/camada: rótulo e valor exato (em centavos, sem o
  // arredondamento da barra) — cada categoria de "Demais" já é sua própria
  // camada, então o tooltip de qualquer uma delas é só isso, igual às outras.
  const tooltips = rows.map((_, i) =>
    sorted.map((k) => {
      const total = cents[i].get(k);
      return total ? `${labels.get(k)!}: ${formatCents(total, hidden)}` : null;
    }),
  );
  // Mês seguinte ao fim de parcelas: quanto a fatura cai.
  const footnotes = rows.map((_, i) => {
    if (i === 0) return null;
    const prev = rows[i - 1];
    const freed = sumBy(
      prev.cardParts.flatMap((c) => c.parts).filter((p) => p.kind === "parcela" && p.lastMonth === prev.month),
      (p) => p.cents,
    );
    return freed > 0n ? formatReais(-toReais(freed), hidden) : null;
  });
  return {
    columns: rows.map((r) => monthShort(r.month).slice(0, 3)),
    columnLabels: rows.map((r) => `${monthLong(r.month)}: fatura de ${formatCents(r.card, hidden)}`),
    layers,
    values,
    footnotes,
    tooltips,
    legend,
  };
}

/** Itens da fatura de um mês, prontos para CalcList. */
export function cardMonthLines(result: FutureResult, index: number): CalcLine[] {
  const row = result.rows[index];
  if (!row) return [];
  return row.cardParts.flatMap((c) =>
    c.parts.map((p): CalcLine => {
      const line: CalcLine = { key: `${c.card}:${p.key}`, label: p.label, value: toReais(p.cents) };
      if (p.kind === "parcela" && p.k !== undefined && p.n !== undefined && p.lastMonth)
        line.note = `parcela ${p.k}/${p.n} · última em ${monthShort(p.lastMonth)}`;
      if (p.kind === "estimado") {
        line.note = "compras já lançadas nesta fatura";
        line.estimate = true;
      }
      return line;
    }),
  );
}

/** Frase de destaque do topo (a "manchete"). */
export function headline(
  input: FutureInput,
  result: FutureResult,
  months: number,
  hidden = false,
): { lead: string; detail: string } {
  const rows = result.rows.slice(0, months);
  // Regra 0: o saldo fica negativo em algum dia (mesmo que o mês feche no azul).
  const dip = rows.find((r) => r.cash.low.cents < 0n && r.free >= 0n);
  if (dip && !rows.some((r) => r.free < 0n && r.month <= dip.month))
    return {
      lead: `Em ${ddmm(dip.cash.low.date)} o saldo fica em ${formatCents(dip.cash.low.cents, hidden)}.`,
      detail: "O mês fecha no azul, mas as contas vencem antes do dinheiro entrar. Veja o mês dia a dia.",
    };
  const tight = rows.find((r) => r.free < 0n);
  if (tight)
    return {
      lead: `Em ${monthShort(tight.month)} falta ${formatCents(-tight.free, hidden)}.`,
      detail: "A diferença sai do saldo em conta. Veja o que dá para ajustar.",
    };

  // Objetivo que passa a completar dentro do horizonte: o mais cedo (empate: maior prioridade).
  const reached = input.goals
    .filter((g) => g.status === "active" && g.saved < g.target)
    .flatMap((g) => {
      const at = result.reach[g.id] ?? null;
      return at !== null && rows.some((r) => r.month === at) ? [{ g, at }] : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.g.priority - b.g.priority)[0];
  if (reached) {
    const monthly = plannedAt(reached.g.plans, input.startMonth);
    return {
      lead: `${reached.g.name} completa em ${monthLong(reached.at)}.`,
      detail:
        monthly > 0n
          ? `Mantendo ${formatCents(monthly, hidden)}/mês, como no plano.`
          : "Sem aporte mensal, só com o que já está guardado.",
    };
  }
  const active = input.goals.filter((g) => g.status === "active" && g.saved < g.target);
  const unplanned = active.length > 0 && rows.every((r) => active.every((g) => (r.goalIn[g.id] ?? 0n) === 0n));
  if (unplanned && rows.length) {
    const low = rows.reduce((a, b) => (b.free < a.free ? b : a));
    return {
      lead: active.length === 1 ? `${active[0].name} ainda não tem aporte planejado.` : "Nenhum objetivo tem aporte planejado.",
      detail: `O mês mais apertado (${monthShort(low.month)}) ainda deixa ${formatCents(low.free, hidden)} de folga. Dá para decidir quanto vai para cada objetivo.`,
    };
  }
  return {
    lead: `Nenhum objetivo completa ${months === 1 ? "no próximo mês" : `nos próximos ${months} meses`}.`,
    detail: result.viability.detail,
  };
}

/** Diferenças do rascunho, prontas para DiffList. */
export function diffRows(diff: DiffItem[], hidden = false): DiffRow[] {
  return diff.map((d) => ({
    key: d.id,
    label: maskMoney(d.label, hidden),
    before: maskMoney(d.before, hidden),
    after: maskMoney(d.after, hidden),
    sense: d.sense,
    ...(d.delta !== undefined ? { delta: maskMoney(d.delta, hidden) } : {}),
  }));
}

// ------------------------------------------------------------------ fatura (T27)

/** Totais da fatura por mês do plano `base` onde diferem do rascunho; null onde são iguais (contorno de comparação). */
export function ghostTotals(base: FutureResult, draft: FutureResult, months: number): (number | null)[] {
  return draft.rows.slice(0, months).map((row, i) => {
    const before = base.rows[i];
    if (!before) return null;
    return toReais(before.card) === toReais(row.card) ? null : toReais(before.card);
  });
}

/** Resumo da fatura no horizonte: primeiro mês e, se cair, o menor valor e quando. */
export function cardSummary(
  result: FutureResult,
  months: number,
  hidden = false,
): { first: string; firstMonth: string; low: { value: string; month: string } | null } | null {
  const rows = result.rows.slice(0, months);
  if (rows.length === 0) return null;
  let lowAt = 0;
  rows.forEach((r, i) => {
    if (r.card < rows[lowAt].card) lowAt = i;
  });
  const low = rows[lowAt].card < rows[0].card ? rows[lowAt] : null;
  return {
    first: formatCents(rows[0].card, hidden),
    firstMonth: monthShort(rows[0].month),
    low: low ? { value: formatCents(low.card, hidden), month: monthShort(low.month) } : null,
  };
}

/** Variação da fatura sobre o mês anterior ("−R$ 570 sobre jan/27"); null no primeiro mês ou sem variação. */
export function billChange(result: FutureResult, index: number, hidden = false): string | null {
  const row = result.rows[index];
  const prev = result.rows[index - 1];
  if (!row || !prev) return null;
  const delta = toReais(row.card - prev.card);
  if (delta === 0) return null;
  return `${formatSignedReais(delta, hidden)} sobre ${monthShort(prev.month)}`;
}

/** Frase de quanto sobra depois das contas e quanto a fatura leva. */
export function cardShare(result: FutureResult, index: number, hidden = false): string {
  const row = result.rows[index];
  if (!row) return "";
  return `Antes do cartão sobram ${formatCents(row.preCard, hidden)}. A fatura leva ${formatCents(row.card, hidden)}, ficam ${formatCents(row.budget, hidden)} para objetivos e folga.`;
}

// ------------------------------------------------------------------ simuladores (T28)

/** Rótulo (e, portanto, chave em `Scenario.purchases`) da compra que o simulador aplica. */
export const SIMULATED_PURCHASE = "Compra simulada";

/** Número de parcelas oferecidas no simulador. */
export const INSTALLMENT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12] as const;

/** Média mensal → semanal, em centavos: semanal = mensal × 7 / 30 (arredonda para o centavo mais próximo). */
export function weeklyFromMonthly(monthly: bigint): bigint {
  return (monthly * 14n + 30n) / 60n;
}

/** Média semanal → mensal, em centavos: mensal = semanal × 30 / 7 (arredonda para o centavo mais próximo). */
export function monthlyFromWeekly(weekly: bigint): bigint {
  return (weekly * 60n + 7n) / 14n;
}

/**
 * Valor que `Scenario.everydayWeekly` deve ter para a média mensal pedida (em reais),
 * ou undefined quando ela é a do plano salvo (aí o rascunho não muda nada).
 */
export function everydayPatch(baseWeekly: bigint | null, monthlyReais: number): bigint | undefined {
  const weekly = weeklyFromMonthly(BigInt(Math.round(monthlyReais)) * 100n);
  if (baseWeekly !== null && toReais(monthlyFromWeekly(baseWeekly)) === Math.round(monthlyReais)) return undefined;
  return weekly;
}

/** "6× de R$ 300": a parcela arredonda para cima, como o motor. */
export function installmentLabel(totalReais: number, installments: number, hidden = false): string {
  return `${installments}× de ${formatReais(Math.ceil(totalReais / installments), hidden)}`;
}

function addMonth(month: string, n: number): string {
  const t = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** Dias possíveis da compra: hoje e o dia 1 de cada um dos 11 meses seguintes. */
export function purchaseDayOptions(input: FutureInput): { value: string; label: string }[] {
  return [
    { value: input.today, label: "Hoje" },
    ...Array.from({ length: 11 }, (_, i) => {
      const m = addMonth(input.startMonth, i + 1);
      return { value: `${m}-01`, label: monthShort(m) };
    }),
  ];
}

/** Menor folga mensal nos primeiros `months` meses (0n se não há linhas). */
export function minFree(result: FutureResult, months: number): bigint {
  const rows = result.rows.slice(0, months);
  return rows.reduce((m, r) => (r.free < m ? r.free : m), rows[0]?.free ?? 0n);
}

// ------------------------------------------------------------------ aporte, decisões e rascunho (T29)


/** Aporte mensal vigente de um objetivo no mês `month` (0n se não há). Exportado para os componentes. */
export const plannedMonthly = plannedAt;

/** Efeito no rascunho de pedir `reais` por mês para um objetivo cujo plano salvo é `planned`. */
export type ContributionChange =
  | { kind: "clear" } // volta ao plano: tira aporte e pausa do rascunho
  | { kind: "contribute"; cents: bigint }
  | { kind: "pause" }; // zero: o aporte com valor 0 não vale como simulação, então é uma pausa

export function contributionChange(planned: bigint, reais: number): ContributionChange {
  const cents = BigInt(Math.round(reais)) * 100n;
  if (cents === planned || (planned === 0n && cents === 0n)) return { kind: "clear" };
  return cents === 0n ? { kind: "pause" } : { kind: "contribute", cents };
}

/** Quanto por mês falta para chegar à meta no prazo (null sem prazo, prazo passado ou meta atingida). */
export function neededForDeadline(
  startMonth: string,
  goal: { target: bigint; saved: bigint; deadlineMonth: string | null },
): bigint | null {
  if (!goal.deadlineMonth) return null;
  // Mesma regra do motor: o mês corrente não conta (contributionMonths).
  const n = contributionMonths(startMonth, goal.deadlineMonth);
  if (n <= 0) return null;
  const need = neededMonthly(goal.target, goal.saved, n);
  return need > 0n ? need : null;
}

/** "Completa em mar/28." ou "Não completa no horizonte." para um objetivo no resultado. */
export function reachText(result: FutureResult, goalId: string): string {
  const at = result.reach[goalId] ?? null;
  return at === null ? "Não completa no horizonte." : `Completa em ${monthShort(at)}.`;
}

/** Resumo do rascunho para a barra: "2 mudanças: {primeira linha}". */
export function draftSummary(changes: number, describe: string[], hidden = false): string {
  const count = `${changes} ${changes === 1 ? "mudança" : "mudanças"}`;
  return describe[0] ? `${count}: ${maskMoney(describe[0], hidden)}` : count;
}

// ------------------------------------------------------------------ dia a dia do mês

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

export type CashRow = { key: string; date: string; label: string; amount: string; balance: string; tone: "in" | "out" | "paid" | "everyday" };

/**
 * O mês na ordem em que o dinheiro se move: a frase do ponto mais baixo e cada
 * movimento datado com o saldo logo depois. O ponto mais baixo é o fim do dia
 * (já com o dia a dia), por isso fica numa frase e não colado a um movimento.
 */
export function cashTimeline(
  row: FutureRow,
  hidden = false,
  paid: Line[] = [],
): { summary: string; everyday: string | null; rows: CashRow[]; negative: boolean } {
  const c = row.cash;
  // Contas já pagas no mês: listadas antes, sem mexer no saldo (ele já desconta).
  const paidRows: CashRow[] = [...paid]
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .map((l) => ({
      key: `paid:${l.key}`,
      date: l.date ? ddmm(l.date) : "",
      label: l.label,
      amount: formatSignedReais(-toReais(l.cents), hidden),
      balance: "paga",
      tone: "paid",
    }));
  const before = c.events.find((e) => e.kind === "entrada" && e.date > c.low.date);
  const summary =
    c.low.cents < 0n
      ? `Em ${ddmm(c.low.date)} o saldo fica em ${formatCents(c.low.cents, hidden)}${before ? `, antes de ${before.label.toLowerCase() === "salário" ? "o salário" : before.label} entrar` : ""}.`
      : `O ponto mais baixo é ${ddmm(c.low.date)}, com ${formatCents(c.low.cents, hidden)} em conta${before ? `, antes de ${before.label.toLowerCase() === "salário" ? "o salário" : before.label} entrar` : ""}.`;
  return {
    summary,
    everyday:
      c.everydayPerDay > 0n || c.everydayOnCard > 0n
        ? [
            c.everydayPerDay > 0n ? `Dia a dia na conta (Pix, débito): cerca de ${formatCents(c.everydayPerDay, hidden)} por dia.` : "",
            c.everydayOnCard > 0n
              ? `No cartão: ${formatCents(c.everydayOnCard, hidden)} neste mês, que saem da conta com a fatura do mês seguinte.`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : null,
    negative: c.low.cents < 0n,
    rows: [...paidRows, ...withEveryday(c, hidden)],
  };
}

/**
 * Os movimentos do mês com o dia a dia entre eles: o que sai por dia (Pix,
 * débito) aparece como uma linha antes do movimento seguinte, para cada queda
 * do saldo ter uma linha que a explica. O dia a dia sai no fim de cada dia.
 */
function withEveryday(c: FutureRow["cash"], hidden: boolean): CashRow[] {
  const month = c.from.slice(0, 7);
  const day = (date: string) => Number(date.slice(8, 10));
  const at = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  const out: CashRow[] = [];
  let balance = c.opening;
  let fromDay = day(c.from);
  const gap = (toDay: number, after: bigint) => {
    const spent = balance - after;
    if (toDay < fromDay || spent < 100n) return;
    out.push({
      key: `dia:${at(toDay)}`,
      date: ddmm(at(toDay)),
      label: toDay === fromDay ? "Dia a dia" : `Dia a dia, ${ddmm(at(fromDay))} a ${ddmm(at(toDay))}`,
      amount: formatSignedReais(-toReais(spent), hidden),
      balance: formatCents(after, hidden),
      tone: "everyday",
    });
  };
  c.events.forEach((e, i) => {
    const before = e.balance - e.cents;
    gap(day(e.date) - 1, before);
    out.push({
      key: `${e.date}:${i}`,
      date: ddmm(e.date),
      label: e.label,
      amount: formatSignedReais(toReais(e.cents), hidden),
      balance: formatCents(e.balance, hidden),
      tone: e.cents >= 0n ? "in" : "out",
    });
    balance = e.balance;
    fromDay = day(e.date);
  });
  gap(day(c.to), c.closing);
  return out;
}

/** Primeiro mês do horizonte em que o saldo fica negativo em algum dia. */
export function firstCashDip(result: FutureResult, months: number): FutureRow | null {
  return result.rows.slice(0, months).find((r) => r.cash.low.cents < 0n) ?? null;
}
