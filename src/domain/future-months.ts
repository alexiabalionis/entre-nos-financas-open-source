// Projeção de 3 a 36 meses do Copiloto "Futuro" (puro, sem I/O). Roda no
// servidor e no navegador: a tela reexecuta projectFuture para simular. Valores
// em centavos (bigint), meses 'YYYY-MM', dias 'YYYY-MM-DD'. O motor de caixa do
// Copiloto atual (projection*.ts) não muda: aqui só se organiza o que ele e os
// leitores já calculam, mês a mês.
import { billForDueMonth, type CycleVersion } from "./card-competence.ts";
import { shiftMonth } from "./card-cycle.ts";
import { floor50, roomFor, shortMonths } from "./sobra.ts";
import { cardPurchaseSchedule } from "./projection-simulate.ts";
import type { Quality } from "./projection-reconcile-shared.ts";

export type Source = "banco" | "manual" | "plano" | "recorrencia" | "estimado";
/** `date` = dia em que o dinheiro entra ou sai ('YYYY-MM-DD'), quando se sabe. */
export type Line = { key: string; label: string; cents: bigint; source: Source; date?: string };
export type MonthAmount = { month: string; cents: bigint; items: Line[] };

/** Total que vence no mês, já com parcelas e recorrentes (o coletor decide a regra). */
export type CardBill = {
  month: string;
  total: bigint;
  quality: Quality;
  source: Source;
  /** Compras avulsas (nem parcela, nem recorrente) do resto, por categoria resolvida. */
  leftoverCategories?: { name: string; cents: bigint }[];
};
export type CardInstallment = {
  key: string;
  label: string;
  cents: bigint;
  k: number;
  n: number;
  month: string;
  lastMonth: string;
  /** Categoria da compra (do lançamento aprovado ou da regra do estabelecimento). */
  category?: string;
};
export type CardFuture = {
  card: string;
  name: string;
  cycles: CycleVersion[];
  bills: CardBill[];
  installments: CardInstallment[];
  /** Recorrentes listados na fatura do mês (já contidos em `bills[].total`). */
  recurring: { key: string; label: string; cents: bigint; month: string; category?: string }[];
};

export type GoalFuture = {
  id: string;
  name: string;
  status: "active" | "paused";
  location: "same_account" | "elsewhere" | null;
  target: bigint;
  saved: bigint;
  deadlineMonth: string | null;
  priority: number;
  /** Planos vigentes por mês, do mês 0 em diante. */
  plans: { month: string; planned: bigint }[];
};

export type Shock = {
  /** "receita" = receita menor: `cents` é quanto entra a menos por mês. */
  kind: "despesa" | "receita";
  month: string;
  months: number;
  cents: bigint;
  label: string;
  /** Dia do mês em que sai (simulação de datas); sem ele, sai no primeiro dia contado. */
  day?: number;
};

export type FutureInput = {
  today: string;
  startMonth: string;
  months: number;
  /** Saldo livre em conta: sConf menos o que está separado na própria conta. */
  startBalance: bigint;
  snapshotDate: string | null;
  income: MonthAmount[];
  fixed: MonthAmount[];
  /**
   * Contas fixas do mês que já foram pagas. Só para mostrar o mês inteiro: o
   * saldo de partida já desconta esse dinheiro, então a projeção não usa.
   */
  paidFixed?: MonthAmount[];
  /**
   * `cardShareBp`: quanto do dia a dia vai no cartão (0 a 10.000). Na folga do
   * mês a compra conta no dia; no saldo dia a dia, essa parte sai da conta no
   * vencimento da fatura do mês seguinte.
   */
  everyday: { weekly: bigint | null; source: "medido" | "declarado" | "ausente"; cardShareBp?: number };
  cards: CardFuture[];
  goals: GoalFuture[];
  essentialsMonthly: bigint;
  shocks?: Shock[];
  freedTo?: "folga" | "objetivos";
  /** Premissas que o coletor já conhece (ex.: saldo lido em data antiga). */
  premises?: string[];
  /**
   * Sinais do mês corrente que o coletor lê fora da projeção (não entram na
   * conta dos meses): gasto por categoria até hoje, o dos mesmos dias do mês
   * passado e o teto do mês (null sem teto). Só alimentam sugestões de aviso.
   */
  signals?: { categories: CategorySignal[]; history?: SobraHistory | null };
};

export type Scenario = {
  /** Nova meta e/ou data de um objetivo existente (o que vocês imaginam precisar e até quando). */
  goalEdits?: { goalId: string; target: bigint; deadlineMonth: string | null }[];
  contributions?: { goalId: string; fromMonth: string; months: number | null; cents: bigint }[];
  pauses?: { goalId: string; fromMonth: string; months: number }[];
  newGoals?: {
    id: string;
    name: string;
    target: bigint;
    saved: bigint;
    deadlineMonth: string | null;
    monthly: bigint;
  }[];
  purchases?: { card: string; cents: bigint; installments: number; day: string; label?: string }[];
  shocks?: Shock[];
  everydayWeekly?: bigint;
  freedTo?: "folga" | "objetivos";
  /** Conta fixa (pelo nome, que se repete todo mês) com outro valor e/ou outro dia de vencimento, de `fromMonth` em diante. */
  fixedEdits?: { label: string; fromMonth: string; cents?: bigint; day?: number }[];
};

export type CardPart = {
  key: string;
  label: string;
  cents: bigint;
  kind: "recorrente" | "parcela" | "fatura" | "estimado";
  category?: string;
  k?: number;
  n?: number;
  lastMonth?: string;
};
export type FutureRow = {
  month: string;
  preCard: bigint;
  card: bigint;
  budget: bigint;
  shocks: bigint;
  goalIn: Record<string, bigint>;
  goalBal: Record<string, bigint>;
  free: bigint;
  bank: bigint;
  reserves: bigint;
  committed: bigint;
  netWorth: bigint;
  cardParts: { card: string; parts: CardPart[] }[];
  /** O mês dia a dia: movimentos datados, o saldo depois de cada um e o ponto mais baixo. */
  cash: MonthCash;
};
/** Um movimento datado do mês. `cents` com sinal; `balance` = saldo livre logo depois. */
export type CashEvent = {
  date: string;
  label: string;
  kind: "entrada" | "conta" | "fatura" | "aporte" | "imprevisto";
  cents: bigint;
  balance: bigint;
};
export type MonthCash = {
  /** Primeiro dia contado (hoje, no mês atual) e último dia do mês. */
  from: string;
  to: string;
  opening: bigint;
  closing: bigint;
  /** Dia a dia que sai da conta por dia (a parte fora do cartão). */
  everydayPerDay: bigint;
  /** Dia a dia no cartão deste mês: sai da conta com a fatura do mês seguinte. */
  everydayOnCard: bigint;
  events: CashEvent[];
  /** Menor saldo do mês e o dia (o fim do dia, já com o dia a dia daquele dia). */
  low: { date: string; cents: bigint };
};
export type Milestone = {
  id: string;
  kind: "goal-reached" | "cover-1" | "cover-3" | "goal-due" | "installment-end" | "all-installments-end";
  month: string;
  refId: string;
  title: string;
  short: string;
  why: string[];
  missed?: boolean;
};
export type CategorySignal = { name: string; cents: bigint; prev: bigint | null; budget: bigint | null };
/**
 * O que sobrou (entrou − saiu) em cada mês fechado dos últimos 12, e a média:
 * o "Sobra por mês" do Panorama. É o que decide se algo novo cabe, porque o
 * plano não projeta o dia a dia (decisão de 19/11/2026).
 */
export type SobraHistory = { avg: bigint; kept: { month: string; cents: bigint }[] };
/** O que a pessoa pode ajustar numa sugestão antes de testar. */
export type DecisionEdit =
  /** Aporte num objetivo a partir de um mês (valor sugerido editável). */
  | { kind: "contribution"; goalId: string; fromMonth: string; cents: bigint }
  /** Valor que a fatura libera a partir de um mês: escolher o objetivo e quanto. */
  | { kind: "freed"; fromMonth: string; cents: bigint };
export type Decision = {
  id: string;
  tone: "atencao" | "oportunidade" | "info";
  title: string;
  calc: string;
  impact: string;
  action?: { label: string; scenario: Scenario };
  /** O número principal da sugestão (diferença, excesso, o que falta): "agora não" volta quando ele muda 20%. */
  metric?: bigint;
  edit?: DecisionEdit;
  /** Aviso sem simulação: aponta para onde agir (ex.: a categoria no Mês). */
  link?: { label: string; href: string };
};
export type DiffItem = {
  id: string;
  label: string;
  before: string;
  after: string;
  /** >0 melhorou, <0 piorou, 0 neutro */
  sense: number;
  delta?: string;
};
export type FutureResult = {
  rows: FutureRow[];
  milestones: Milestone[];
  /** goalId -> mês em que completa (o mês 0 se já estava completo); null = fora do horizonte. */
  reach: Record<string, string | null>;
  conflicts: { month: string; cents: bigint; cause: string }[];
  viability: { level: "ok" | "apertado" | "inviavel"; title: string; detail: string };
  decisions: Decision[];
  premises: string[];
};

// ------------------------------------------------------------------ texto

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** "R$ 4.100", em reais inteiros (arredonda para o real mais próximo). */
export function reais(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  const whole = (abs + 50n) / 100n;
  const text = BRL.format(Number(whole)).replace(/\u00a0/g, " ");
  return cents < 0n && whole > 0n ? "−" + text : text;
}
const signed = (cents: bigint) => (cents > 0n ? "+" : "") + reais(cents);
export const monthShort = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
export const monthLong = (m: string) => `${MES_LONGO[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
export const monthsBetween = (a: string, b: string) => monthIndex(b) - monthIndex(a);

/**
 * Quantos aportes mensais cabem até um prazo. Regra (decisão da pessoa,
 * 19/11/2026): o mês corrente nunca conta, o primeiro aporte é no mês
 * seguinte; um mês conta se termina até o prazo. Prazo por mês ("até
 * dezembro") = fim daquele mês. Prazo por dia: o mês do dia só conta se o dia
 * for o último dele (15/12 → conta até novembro).
 */
export function contributionMonths(startMonth: string, deadline: string): number {
  return Math.max(0, monthsBetween(startMonth, lastCountedMonth(deadline)));
}

/** O último mês que termina até o prazo ("2026-12" → ele mesmo; "2026-12-15" → "2026-11"). */
export function lastCountedMonth(deadline: string): string {
  const month = deadline.slice(0, 7);
  if (deadline.length === 7) return month;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(deadline.slice(8, 10)) >= lastDay ? month : shiftMonth(month, -1);
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function daysIn(month: string): number {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
}
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** Aporte mensal para chegar à meta, em reais inteiros para cima (o que a tela mostra). */
export function neededMonthly(target: bigint, saved: bigint, months: number): bigint {
  const rest = target - saved;
  if (rest <= 0n || months <= 0) return 0n;
  const per = (rest + BigInt(months) - 1n) / BigInt(months);
  return ((per + 99n) / 100n) * 100n;
}

// ------------------------------------------------------------------ plano

function planFor(plans: readonly { month: string; planned: bigint }[], month: string): bigint {
  let best: { month: string; planned: bigint } | null = null;
  for (const p of plans) if (p.month <= month && (!best || p.month > best.month)) best = p;
  return best?.planned ?? 0n;
}

function sumBy(list: readonly MonthAmount[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const a of list) out.set(a.month, (out.get(a.month) ?? 0n) + a.cents);
  return out;
}

function everydayFor(input: FutureInput, month: string, first: boolean): bigint {
  const weekly = input.everyday.weekly;
  if (weekly === null) return 0n;
  const total = daysIn(month);
  const days = first ? total - Number(input.today.slice(8, 10)) + 1 : total;
  return (weekly * BigInt(Math.max(0, days))) / 7n;
}

function cardParts(card: CardFuture, month: string): { total: bigint; parts: CardPart[] } | null {
  const bill = card.bills.find((b) => b.month === month);
  const installments = card.installments.filter((p) => p.month === month);
  const recurring = card.recurring.filter((r) => r.month === month);
  if (!bill && !installments.length && !recurring.length) return null;
  const total = bill?.total ?? 0n;
  const parts: CardPart[] = [
    ...installments.map((p) => ({
      key: p.key, label: p.label, cents: p.cents, kind: "parcela" as const, k: p.k, n: p.n, lastMonth: p.lastMonth,
      ...(p.category ? { category: p.category } : {}),
    })),
    ...recurring.map((r) => ({
      key: r.key, label: r.label, cents: r.cents, kind: "recorrente" as const, ...(r.category ? { category: r.category } : {}),
    })),
  ];
  const listed = parts.reduce((s, p) => s + p.cents, 0n);
  let rest = total - listed;
  const knownBill = bill && (bill.source === "banco" || bill.source === "manual");
  if (rest > 0n && !knownBill && bill?.leftoverCategories?.length) {
    for (const c of bill.leftoverCategories) {
      const cents = c.cents < rest ? c.cents : rest;
      if (cents <= 0n) continue;
      parts.push({ key: `${card.card}:${month}:resto:${c.name}`, label: c.name, cents, kind: "estimado", category: c.name });
      rest -= cents;
    }
  }
  if (rest > 0n)
    parts.push({
      key: `${card.card}:${month}:resto`,
      label: knownBill ? `Valor informado · ${card.name}` : "Outras compras",
      cents: rest,
      kind: knownBill ? "fatura" : "estimado",
    });
  // Parcelas e recorrentes passam do total que sobrou: parte da fatura já foi paga.
  else if (rest < 0n)
    parts.push({ key: `${card.card}:${month}:pago`, label: "Já pago nesta fatura", cents: rest, kind: "fatura" });
  return { total, parts };
}

function reserveGoal(goals: readonly GoalFuture[]): GoalFuture | null {
  return [...goals].filter((g) => g.status !== "paused").sort((a, b) => a.priority - b.priority)[0] ?? null;
}


// ------------------------------------------------------------------ dia a dia

const pad2 = (n: number) => String(n).padStart(2, "0");
const dayOf = (month: string, d: number) => `${month}-${pad2(Math.min(d, daysIn(month)))}`;

/**
 * Caminho do saldo livre dentro do mês: entradas e contas no dia em que caem,
 * fatura no vencimento, aportes no dia do salário e o dia a dia repartido igual
 * entre os dias. Sem data conhecida, entra no primeiro dia (como a conta mensal:
 * não inventa um aperto que os dados não mostram). No mesmo dia, a entrada vem
 * antes das saídas.
 * A parte do dia a dia no cartão sai no vencimento da fatura do mês seguinte,
 * então fecha em opening + free + (cartão deste mês) − (cartão do mês passado).
 */
function monthCash(p: {
  input: FutureInput;
  month: string;
  first: boolean;
  opening: bigint;
  everyday: bigint;
  /** Parte do dia a dia deste mês que vai no cartão (sai no mês seguinte). */
  everydayOnCard: bigint;
  /** Dia a dia no cartão do mês anterior: sai agora, no vencimento da fatura. */
  prevEverydayOnCard: bigint;
  cards: { card: CardFuture; total: bigint }[];
  shocks: { label: string; cents: bigint; day?: number }[];
  toGoals: bigint;
}): MonthCash {
  const { input, month } = p;
  const startDay = p.first ? Number(input.today.slice(8, 10)) : 1;
  const from = dayOf(month, startDay);
  const to = dayOf(month, daysIn(month));
  const clamp = (date: string | undefined, fallback: string) => {
    if (!date || date.slice(0, 7) !== month) return fallback;
    return date < from ? from : date > to ? to : date;
  };
  type Raw = Omit<CashEvent, "balance">;
  const raw: Raw[] = [];
  for (const a of input.income.filter((x) => x.month === month))
    for (const l of a.items) raw.push({ date: clamp(l.date, from), label: l.label, kind: "entrada", cents: l.cents });
  // Itens sem detalhe (só o total do mês) entram como uma linha só.
  for (const a of input.income.filter((x) => x.month === month && x.items.length === 0))
    raw.push({ date: from, label: "Entradas", kind: "entrada", cents: a.cents });
  for (const a of input.fixed.filter((x) => x.month === month))
    for (const l of a.items) raw.push({ date: clamp(l.date, from), label: l.label, kind: "conta", cents: -l.cents });
  for (const a of input.fixed.filter((x) => x.month === month && x.items.length === 0))
    raw.push({ date: from, label: "Contas fixas", kind: "conta", cents: -a.cents });
  for (const c of p.cards) {
    if (c.total === 0n) continue;
    const due = billForDueMonth(c.card.cycles, month)?.dueDate;
    raw.push({
      date: clamp(due, from),
      label: p.prevEverydayOnCard > 0n ? `Fatura ${c.card.name}: parcelas e recorrentes` : `Fatura ${c.card.name}`,
      kind: "fatura",
      cents: -c.total,
    });
  }
  if (p.prevEverydayOnCard > 0n) {
    // Vai com a fatura do cartão de maior valor (a que vence com as compras do dia a dia).
    const main = [...p.cards].sort((a, b) => (a.total === b.total ? 0 : a.total > b.total ? -1 : 1))[0];
    const due = main ? billForDueMonth(main.card.cycles, month)?.dueDate : undefined;
    raw.push({
      date: clamp(due, from),
      label: main ? `Fatura ${main.card.name}: compras do dia a dia do mês passado` : "Fatura: compras do dia a dia do mês passado",
      kind: "fatura",
      cents: -p.prevEverydayOnCard,
    });
  }
  for (const sh of p.shocks)
    raw.push({ date: sh.day ? clamp(dayOf(month, Math.min(sh.day, daysIn(month))), from) : from, label: sh.label, kind: "imprevisto", cents: -sh.cents });
  if (p.toGoals > 0n) {
    const payday = raw.filter((e) => e.kind === "entrada").sort((a, b) => (a.cents > b.cents ? -1 : 1))[0]?.date ?? to;
    raw.push({ date: payday, label: "Aportes nos objetivos", kind: "aporte", cents: -p.toGoals });
  }
  const order = { entrada: 0, conta: 1, fatura: 2, imprevisto: 3, aporte: 4 } as const;
  raw.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);

  const days = daysIn(month) - startDay + 1;
  const inCash = p.everyday - p.everydayOnCard;
  const perDay = days > 0 ? inCash / BigInt(days) : 0n;
  const rest = inCash - perDay * BigInt(days); // centavos que sobram da divisão: no último dia
  let balance = p.opening;
  let low = { date: from, cents: p.opening };
  const events: CashEvent[] = [];
  let k = 0;
  for (let d = startDay; d <= daysIn(month); d++) {
    const date = dayOf(month, d);
    for (; k < raw.length && raw[k].date === date; k++) {
      balance += raw[k].cents;
      events.push({ ...raw[k], balance });
    }
    balance -= perDay + (d === daysIn(month) ? rest : 0n);
    if (balance < low.cents) low = { date, cents: balance };
  }
  return { from, to, opening: p.opening, closing: balance, everydayPerDay: perDay, everydayOnCard: p.everydayOnCard, events, low };
}

// ------------------------------------------------------------------ projeção

export function projectFuture(input: FutureInput): FutureResult {
  if (!Number.isInteger(input.months) || input.months < 1)
    throw new Error("A projeção precisa de pelo menos 1 mês.");
  const months = Array.from({ length: input.months }, (_, i) => shiftMonth(input.startMonth, i));
  const incomeBy = sumBy(input.income);
  const fixedBy = sumBy(input.fixed);
  const shocks = input.shocks ?? [];
  const goals = [...input.goals].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const balance: Record<string, bigint> = Object.fromEntries(goals.map((g) => [g.id, g.saved]));
  const reach: Record<string, string | null> = Object.fromEntries(
    goals.map((g) => [g.id, g.saved >= g.target ? input.startMonth : null]),
  );
  const firstContribution: Record<string, number> = {};
  const aportes: Record<string, number> = {};
  const rows: FutureRow[] = [];
  const conflicts: FutureResult["conflicts"] = [];
  let bank = input.startBalance;
  // Saldo do caminho dia a dia: o que sobra fica na conta e abre o mês seguinte
  // (o dia a dia já conta todo o gasto). `bank` segue a regra antiga (só déficits).
  let cashCarry = input.startBalance;
  let prevOnCard = 0n;
  const shareBp = BigInt(Math.max(0, Math.min(10000, input.everyday.cardShareBp ?? 0)));
  let regularOver = 0n;
  // Verba típica: a mediana da verba dos meses (um mês de fatura alta ou o mês 0,
  // que só tem os dias que restam, não deve decidir sozinho).
  const budgetAt = (month: string, i: number) =>
    (incomeBy.get(month) ?? 0n) -
    (fixedBy.get(month) ?? 0n) -
    everydayFor(input, month, i === 0) -
    input.cards.reduce((s, c) => s + (cardParts(c, month)?.total ?? 0n), 0n);
  const sortedBudgets = months
    .map((m, i) => budgetAt(m, i))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const typical = sortedBudgets[Math.floor((sortedBudgets.length - 1) / 2)];
  // Uma entrada por série (key): a parcela que terminou libera esse valor.
  const ended = (month: string) => {
    const byKey = new Map<string, bigint>();
    for (const p of input.cards.flatMap((c) => c.installments))
      if (p.lastMonth < month) byKey.set(p.key, p.cents);
    return [...byKey.values()];
  };

  months.forEach((month, i) => {
    const opening = cashCarry;
    const preCard = (incomeBy.get(month) ?? 0n) - (fixedBy.get(month) ?? 0n) - everydayFor(input, month, i === 0);
    const cards = input.cards.map((c) => ({ card: c, shown: cardParts(c, month) }));
    const card = cards.reduce((s, c) => s + (c.shown?.total ?? 0n), 0n);
    const budget = preCard - card;
    const shockOut = shocks
      .filter((s) => month >= s.month && monthsBetween(s.month, month) < s.months)
      .reduce((s, x) => s + x.cents, 0n);

    const goalIn: Record<string, bigint> = {};
    for (const g of goals) {
      const planned = g.status === "paused" ? 0n : planFor(g.plans, month);
      const c = min(max(g.target - balance[g.id], 0n), planned);
      goalIn[g.id] = c;
    }
    // Valor liberado por parcela que terminou: vai para os objetivos por prioridade.
    if (input.freedTo === "objetivos") {
      let pool = ended(month).reduce((s, c) => s + c, 0n);
      for (const g of goals) {
        if (pool <= 0n) break;
        if (g.status === "paused") continue;
        const room = max(g.target - balance[g.id] - goalIn[g.id], 0n);
        const x = min(room, pool);
        goalIn[g.id] += x;
        pool -= x;
      }
    }
    let toGoals = 0n;
    for (const g of goals) {
      balance[g.id] += goalIn[g.id];
      toGoals += goalIn[g.id];
      if (goalIn[g.id] > 0n) {
        firstContribution[g.id] ??= i;
        aportes[g.id] = (aportes[g.id] ?? 0) + 1;
      }
      if (reach[g.id] === null && balance[g.id] >= g.target) reach[g.id] = month;
    }

    const free = budget - shockOut - toGoals;
    if (free < 0n) {
      bank += free;
      const over = toGoals - typical;
      const regular = shockOut === 0n && over > 0n;
      if (regular) regularOver = max(regularOver, over);
      conflicts.push({
        month,
        cents: -free,
        cause: regular
          ? "Aportes passam da verba do mês"
          : shockOut > 0n
            ? shocks
                .filter((s) => month >= s.month && monthsBetween(s.month, month) < s.months)
                .map((s) => s.label)
                .join(" · ")
            : `Fatura do cartão de ${reais(card)}`,
      });
    }
    const reserves = Object.values(balance).reduce((s, v) => s + v, 0n);
    const committed = input.cards
      .flatMap((c) => c.installments)
      .filter((p) => p.month > month)
      .reduce((s, p) => s + p.cents, 0n);
    rows.push({
      month, preCard, card, budget, shocks: shockOut,
      goalIn, goalBal: { ...balance },
      free, bank, reserves, committed,
      netWorth: bank + reserves - committed,
      cardParts: cards.flatMap((c) => (c.shown ? [{ card: c.card.card, parts: c.shown.parts }] : [])),
      cash: monthCash({
        input,
        month,
        first: i === 0,
        opening,
        everyday: everydayFor(input, month, i === 0),
        everydayOnCard: (everydayFor(input, month, i === 0) * shareBp) / 10000n,
        prevEverydayOnCard: prevOnCard,
        cards: cards.map((c) => ({ card: c.card, total: c.shown?.total ?? 0n })),
        shocks: shocks
          .filter((x) => month >= x.month && monthsBetween(x.month, month) < x.months)
          .map((x) => ({ label: x.label, cents: x.cents, ...(x.day ? { day: x.day } : {}) })),
        toGoals,
      }),
    });
    cashCarry = rows[rows.length - 1].cash.closing;
    prevOnCard = rows[rows.length - 1].cash.everydayOnCard;
  });

  const milestones = milestonesFor(input, goals, rows, reach, firstContribution, aportes);
  const viability = viabilityOf(rows, conflicts, regularOver, typical);
  return {
    rows,
    milestones,
    reach,
    conflicts,
    viability,
    decisions: decisionsFor(input, goals, rows, conflicts, milestones, regularOver, typical),
    premises: premisesFor(input),
  };
}

function premisesFor(input: FutureInput): string[] {
  const out = [
    "A folga livre de cada mês é considerada gasta no próprio mês. O saldo em conta só muda quando falta folga.",
    "A reserva não cobre déficits: não é dinheiro para gasto corrente. O que está separado na própria conta fica fora do saldo livre.",
    "Aporte de um mês sem plano repete o último plano conhecido. Sem plano nenhum, o aporte é zero.",
    "Patrimônio no escopo do app: saldo livre + reservas − parcelas futuras do cartão. Bens e investimentos não cadastrados ficam de fora.",
    "Juros, rendimento e cotação não são estimados.",
  ];
  if (input.everyday.source === "ausente")
    out.push("O dia a dia não entra na conta: a folga do mês é o que sobra para ele depois das contas fixas e da fatura.");
  if (input.everyday.source === "declarado") out.push("Dia a dia pelo valor semanal que você informou.");
  if (input.everyday.source === "medido") out.push("Dia a dia pela mediana das últimas semanas, sem parcelas e contas já previstas.");
  const reserve = reserveGoal(input.goals);
  if (reserve) out.push(`Cobertura da reserva calculada sobre "${reserve.name}", o objetivo de maior prioridade.`);
  return [...out, ...(input.premises ?? [])];
}

// ------------------------------------------------------------------ marcos

function milestonesFor(
  input: FutureInput,
  goals: GoalFuture[],
  rows: FutureRow[],
  reach: Record<string, string | null>,
  first: Record<string, number>,
  aportes: Record<string, number>,
): Milestone[] {
  const out: Milestone[] = [];
  const startMonth = input.startMonth;
  for (const g of goals) {
    const at = reach[g.id];
    if (at && g.saved < g.target) {
      const n = aportes[g.id] ?? 0;
      const row = rows.find((r) => r.month === at)!;
      const monthly = planFor(g.plans, at);
      out.push({
        id: "reach-" + g.id, kind: "goal-reached", month: at, refId: g.id,
        title: `${g.name} completa`, short: `${g.name} completa`,
        why: [
          `Faltavam ${reais(g.target - g.saved)} (${reais(g.saved)} de ${reais(g.target)}).`,
          `${plural(n, "aporte", "aportes")} de ${reais(monthly)}${first[g.id] !== undefined ? `, a partir de ${monthShort(rows[first[g.id]].month)}` : ""}.`,
          `O último aporte completa o valor em ${monthLong(row.month)}.`,
        ],
      });
    }
    if (g.deadlineMonth && rows.some((r) => r.month === g.deadlineMonth)) {
      const v = rows.find((r) => r.month === g.deadlineMonth)!.goalBal[g.id];
      const missed = v < g.target;
      const monthly = planFor(g.plans, g.deadlineMonth);
      out.push({
        id: "due-" + g.id, kind: "goal-due", month: g.deadlineMonth, refId: g.id,
        title: missed ? `${g.name}: data chega com ${reais(v)}` : `${g.name}: data desejada`,
        short: missed ? `${g.name} · falta ${reais(g.target - v)}` : g.name,
        missed,
        why: [
          `Data desejada: ${monthLong(g.deadlineMonth)}. Meta de ${reais(g.target)}.`,
          `Projetado até lá: ${reais(v)}${missed ? `, faltando ${reais(g.target - v)}` : ""}.`,
          monthly === 0n ? "Ainda não há aporte definido." : `Aporte de ${reais(monthly)}/mês.`,
        ],
      });
    }
  }
  const reserve = reserveGoal(goals);
  if (reserve && input.essentialsMonthly > 0n) {
    for (const k of [1, 3] as const) {
      const need = input.essentialsMonthly * BigInt(k);
      if (reserve.saved >= need) continue;
      const row = rows.find((r) => r.goalBal[reserve.id] >= need);
      if (!row) continue;
      out.push({
        id: `cover-${k}-${reserve.id}`, kind: k === 1 ? "cover-1" : "cover-3", month: row.month, refId: reserve.id,
        title: k === 1 ? "Reserva cobre 1 mês de essenciais" : "Reserva cobre 3 meses de essenciais",
        short: k === 1 ? "1 mês coberto" : "3 meses cobertos",
        why: [
          `Essenciais: ${reais(input.essentialsMonthly)}/mês × ${k} = ${reais(need)}.`,
          `Reserva projetada em ${monthLong(row.month)}: ${reais(row.goalBal[reserve.id])}.`,
        ],
      });
    }
  }
  const lastMonth = rows[rows.length - 1].month;
  const series = input.cards.flatMap((c) => {
    const byKey = new Map<string, CardInstallment>();
    for (const p of c.installments) {
      const prior = byKey.get(p.key);
      if (!prior || p.k > prior.k) byKey.set(p.key, p);
    }
    return [...byKey.values()];
  });
  const ending = series.filter((p) => p.lastMonth >= startMonth && p.lastMonth <= lastMonth);
  // Duas compras na mesma loja que terminam no mesmo mês viram um marco só.
  const sameEnd = new Map<string, CardInstallment[]>();
  for (const p of ending) sameEnd.set(`${p.label}|${p.lastMonth}`, [...(sameEnd.get(`${p.label}|${p.lastMonth}`) ?? []), p]);
  for (const group of sameEnd.values()) {
    const p = group[0];
    const cents = group.reduce((s, x) => s + x.cents, 0n);
    out.push({
      id: "end-" + p.key, kind: "installment-end", month: p.lastMonth, refId: p.key,
      title: group.length > 1 ? `Última parcela: ${p.label} (${group.length} compras)` : `Última parcela: ${p.label}`,
      short: `${p.label} termina`,
      why: [
        group.length > 1
          ? `${group.length} compras parceladas, ${reais(cents)} por mês juntas.`
          : `Parcela ${p.n} de ${p.n}, ${reais(p.cents)}.`,
        `A fatura cai ${reais(cents)} no mês seguinte.`,
      ],
    });
  }
  if (ending.length > 1) {
    const at = ending.map((p) => p.lastMonth).sort().at(-1)!;
    out.push({
      id: "end-all", kind: "all-installments-end", month: at, refId: "installments",
      title: "Sem parcelas no cartão", short: "Sem parcelas",
      why: [`A última parcela termina em ${monthLong(at)}.`],
    });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || a.kind.localeCompare(b.kind));
}

// ------------------------------------------------------------------ leitura

function viabilityOf(
  rows: FutureRow[],
  conflicts: FutureResult["conflicts"],
  regularOver: bigint,
  budget0: bigint,
): FutureResult["viability"] {
  const within = conflicts.filter((c) => rows.some((r) => r.month === c.month));
  const minBank = rows.reduce((m, r) => min(m, r.bank), rows[0].bank);
  if (regularOver > 0n)
    return {
      level: "inviavel",
      title: `Passa da verba em ${reais(regularOver)}/mês`,
      detail: `Os aportes somam mais que os ${reais(budget0)} disponíveis. A diferença sairia do saldo em conta todo mês.`,
    };
  if (minBank < 0n)
    return { level: "inviavel", title: "Saldo em conta fica negativo", detail: `Chega a ${reais(minBank)} na projeção.` };
  if (within.length) {
    const total = within.reduce((s, c) => s + c.cents, 0n);
    return {
      level: "apertado",
      title: plural(within.length, "mês sem folga", "meses sem folga"),
      detail: `Faltam ${reais(total)} no total (${within.map((c) => monthShort(c.month)).join(", ")}), cobertos pelo saldo em conta.`,
    };
  }
  return { level: "ok", title: "Cabe na verba", detail: "Nenhum mês do horizonte fica sem folga." };
}

/** Quanto de um mês de essenciais a reserva cobre, em palavras ("menos de 1%", "35%", "0,8"). */
function coverShare(saved: bigint, monthly: bigint): string {
  const ratio = Number(saved) / Number(monthly);
  if (ratio < 0.01) return "menos de 1%";
  return `${Math.round(ratio * 100)}%`;
}

function decisionsFor(
  input: FutureInput,
  goals: GoalFuture[],
  rows: FutureRow[],
  conflicts: FutureResult["conflicts"],
  milestones: Milestone[],
  regularOver: bigint,
  typical: bigint,
): Decision[] {
  const out: Decision[] = [];
  const reserve = reserveGoal(goals);
  const r0 = rows[0];
  const horizon24 = rows.slice(0, 24);

  const conflict = conflicts.find((c) => horizon24.some((r) => r.month === c.month));
  if (conflict) {
    const r = rows.find((x) => x.month === conflict.month)!;
    const aporte = Object.values(r.goalIn).reduce((s, v) => s + v, 0n);
    const target = reserve && r.goalIn[reserve.id] > 0n ? reserve : null;
    const cut = target ? min(r.goalIn[target.id], conflict.cents) : 0n;
    out.push({
      id: "tight",
      tone: "atencao",
      title:
        r.card > r0.card
          ? `A fatura de ${monthShort(conflict.month)} consome toda a folga prevista.`
          : `${monthLong(conflict.month).replace(/^./, (c) => c.toUpperCase())} não tem folga suficiente.`,
      calc: `${reais(r.preCard)} livres antes do cartão − fatura de ${reais(r.card)}${r.shocks ? ` − ${reais(r.shocks)} de imprevisto` : ""} − ${reais(aporte)} de aportes = ${reais(r.free)}.`,
      impact: `Sem ajuste, ${reais(conflict.cents)} saem do saldo em conta nesse mês.`,
      metric: conflict.cents,
      action: target
        ? {
            label: `Simular aporte de ${reais(r.goalIn[target.id] - cut)} na reserva em ${monthShort(conflict.month)}`,
            scenario: { contributions: [{ goalId: target.id, fromMonth: conflict.month, months: 1, cents: r.goalIn[target.id] - cut }] },
          }
        : undefined,
    });
  }

  // A sobra de verdade (Panorama) decide quanto sugerir; sem histórico, a
  // menor folga projetada (o jeito antigo) faz as vezes.
  const history = input.signals?.history ?? null;
  const plannedNow = goals.reduce((s, g) => s + planFor(g.plans, shiftMonth(input.startMonth, 1)), 0n);
  const sobra = history ? roomFor(history, plannedNow) : null;
  const sobraNote = history ? `costumam sobrar ${reais(history.avg)} por mês` : "";
  /** Mês em que completa guardando `cents` por mês a partir do mês que vem. */
  const doneBy = (missing: bigint, cents: bigint) =>
    cents > 0n ? shiftMonth(input.startMonth, Number((missing + cents - 1n) / cents)) : null;

  if (reserve && input.essentialsMonthly > 0n && reserve.saved < input.essentialsMonthly) {
    const monthly = planFor(reserve.plans, shiftMonth(input.startMonth, 1));
    const missing = input.essentialsMonthly - reserve.saved;
    // O motor para de aportar quando o objetivo bate a meta: sugerir mais que
    // o que falta para a meta não mexe na conta.
    const toTarget = reserve.target > reserve.saved ? reserve.target - reserve.saved : 0n;
    const lowest = rows.reduce((m, r) => min(m, r.free), rows[0].free);
    // O máximo que cabe: o que já vai para ela mais o espaço livre na sobra.
    const room = monthly + (sobra !== null ? (sobra > 0n ? sobra : 0n) : lowest > 0n ? lowest : 0n);
    const fits = floor50(min(min(missing, toTarget), room));
    const shortTarget = reserve.target < input.essentialsMonthly;
    const reach = doneBy(min(missing, toTarget), fits);
    const from = shiftMonth(input.startMonth, 1);
    out.push({
      id: "cover",
      tone: "atencao",
      title: `A ${reserve.name} cobre ${coverShare(reserve.saved, input.essentialsMonthly)} de um mês de despesas essenciais.`,
      calc: `${reais(reserve.saved)} guardados; um mês de essenciais custa ${reais(input.essentialsMonthly)}. Faltam ${reais(missing)}.`,
      impact: shortTarget
        ? `A meta dela é ${reais(reserve.target)}: completa, cobre ${coverShare(reserve.target, input.essentialsMonthly)} de um mês. Para cobrir um mês inteiro, a meta precisa subir para ${reais(input.essentialsMonthly)}.`
        : fits > monthly && reach
          ? `${sobraNote ? `Como ${sobraNote}, dá` : "Dá"} para guardar até ${reais(fits)} por mês: cobre um mês em ${monthLong(reach)}.`
          : sobraNote
            ? `Hoje não sobra espaço: ${sobraNote} e os aportes do plano já usam isso.`
            : "Sem aporte, a cobertura não muda.",
      metric: missing,
      ...(fits > monthly
        ? {
            action: {
              label: `Guardar ${reais(fits)} por mês`,
              scenario: { contributions: [{ goalId: reserve.id, fromMonth: from, months: null, cents: fits }] },
            },
            edit: { kind: "contribution" as const, goalId: reserve.id, fromMonth: from, cents: fits },
          }
        : {}),
    });
  }

  for (const g of goals) {
    if (!g.deadlineMonth) continue;
    const due = milestones.find((m) => m.id === "due-" + g.id);
    if (!due?.missed) continue;
    // Aportes do mês seguinte até o prazo (o mês corrente não conta).
    const n = contributionMonths(input.startMonth, g.deadlineMonth);
    if (n === 0) continue; // vence neste mês: não há aporte novo que chegue a tempo
    const need = neededMonthly(g.target, g.saved, n);
    const missing = g.target - g.saved;
    const span = rows.slice(1, Math.min(n + 1, rows.length));
    if (span.length === 0) continue;
    const tight = span.reduce((a, b) => (b.free < a.free ? b : a));
    // Fora do histórico, decide o mês mais apertado da projeção.
    const own = planFor(g.plans, shiftMonth(input.startMonth, 1));
    const space = sobra !== null ? sobra + own : tight.free;
    const fitsIn = need <= space;
    const slower = floor50(space);
    const later = !fitsIn && slower > 0n ? doneBy(missing, slower) : null;
    out.push({
      id: "compete-" + g.id,
      tone: fitsIn ? "info" : "atencao",
      title: `${g.name} precisa de ${reais(need)} por mês para fechar em ${monthShort(g.deadlineMonth)}.`,
      calc: `Faltam ${reais(missing)} em ${n} ${n === 1 ? "aporte" : "aportes"} (o primeiro em ${monthShort(shiftMonth(input.startMonth, 1))}).`,
      impact: fitsIn
        ? history && sobra !== null
          ? (() => {
              const short = shortMonths(history, plannedNow - own, need).length;
              const share = space > 0n ? Number((need * 100n) / space) : 100;
              return `Usa ${share}% do que costuma sobrar (${reais(space)} por mês)${short > 0 ? `; em ${short} dos ${history.kept.length} meses fechados, sobrou menos que isso` : ""}.`;
            })()
          : `No mês mais apertado até lá (${monthShort(tight.month)}), a folga cai para ${reais(tight.free - need)}.`
        : `${sobraNote ? `É mais que os ${reais(space)} que ${sobraNote.replace(/ por mês$/, "")} para isso` : `Não cabe em ${monthShort(tight.month)}`}.${later ? ` Com ${reais(slower)} por mês, fecha em ${monthLong(later)}.` : ""}`,
      action: {
        label: `Guardar ${reais(need)} por mês`,
        scenario: { contributions: [{ goalId: g.id, fromMonth: shiftMonth(input.startMonth, 1), months: null, cents: need }] },
      },
      metric: need,
      edit: { kind: "contribution", goalId: g.id, fromMonth: shiftMonth(input.startMonth, 1), cents: need },
    });
  }

  if (regularOver > 0n)
    out.push({
      id: "over",
      tone: "atencao",
      title: "Os aportes passam da verba do mês.",
      calc: `Verba típica de ${reais(typical)} contra ${reais(Object.values(r0.goalIn).reduce((s, v) => s + v, 0n))} de aportes no mês.`,
      impact: `A diferença de ${reais(regularOver)} sairia do saldo em conta todo mês.`,
      metric: regularOver,
    });

  const endings = milestones.filter((m) => m.kind === "installment-end" && monthsBetween(input.startMonth, m.month) < 12);
  const ending = endings[0];
  if (ending) {
    const at = shiftMonth(ending.month, 1);
    const before = rows.find((r) => r.month === ending.month);
    const after = rows.find((r) => r.month === at);
    if (before && after && after.card < before.card)
      out.push({
        id: "card-end",
        tone: "oportunidade",
        title: `A partir de ${monthLong(at).split(" de ")[0]}, a fatura fica ${reais(before.card - after.card)} menor.`,
        calc: `Termina o parcelamento de ${ending.title.replace("Última parcela: ", "")}: ${reais(before.card)} em ${monthShort(before.month)}, ${reais(after.card)} em ${monthShort(at)}.`,
        impact: "Sem destino, esse dinheiro se perde no dia a dia. Escolham agora para onde ele vai.",
        action: { label: "Escolher o destino", scenario: { freedTo: "objetivos" } },
        metric: before.card - after.card,
        edit: { kind: "freed", fromMonth: at, cents: before.card - after.card },
      });
  }

  // Avisos do mês por categoria (sem simulação: o dia a dia não é projetado).
  // Uma sugestão por categoria: passar do teto vence "subindo".
  const last = monthLong(shiftMonth(input.startMonth, -1)).split(" de ")[0];
  for (const c of input.signals?.categories ?? []) {
    const name = c.name;
    const link = { label: `Ver ${name} no Mês`, href: `/?month=${input.startMonth}` };
    if (c.budget !== null && c.cents > c.budget) {
      const over = c.cents - c.budget;
      out.push({
        id: "budget-" + name,
        tone: "atencao",
        title: `${name} passou ${reais(over)} do teto do mês.`,
        calc: `${reais(c.cents)} gastos até hoje; teto de ${reais(c.budget)}.`,
        impact: "Esse excesso sai do que sobraria no fim do mês.",
        metric: over,
        link,
      });
      continue;
    }
    // Mesma régua do Panorama (categoryReading): ≥ R$ 50 e ≥ 25% acima.
    if (c.prev !== null && c.cents - c.prev >= 5000n && c.cents * 4n > c.prev * 5n) {
      const up = c.cents - c.prev;
      out.push({
        id: "rise-" + name,
        tone: "info",
        title: `${name} está ${reais(up)} acima dos mesmos dias de ${last}.`,
        calc: `${reais(c.cents)} até hoje contra ${reais(c.prev)} nos mesmos dias de ${last}.`,
        impact: "Essa diferença já saiu do que sobraria no fim do mês.",
        metric: up,
        link,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------ cenário

export function applyScenario(input: FutureInput, s: Scenario): FutureInput {
  let goals = input.goals.map((g) => ({ ...g, plans: [...g.plans] }));
  const setRange = (goalId: string, fromMonth: string, months: number | null, cents: bigint) => {
    goals = goals.map((g) => {
      if (g.id !== goalId) return g;
      // `months: null` vale até o fim: apaga planos de fromMonth em diante.
      const end = months === null ? null : shiftMonth(fromMonth, months);
      const restore = end === null ? null : planFor(g.plans, end);
      const plans = g.plans.filter((p) => p.month < fromMonth || (end !== null && p.month > end));
      plans.push({ month: fromMonth, planned: cents });
      if (end !== null && restore !== null) plans.push({ month: end, planned: restore });
      return { ...g, plans: plans.sort((a, b) => a.month.localeCompare(b.month)) };
    });
  };
  // Objetivos novos entram antes dos aportes: um aporte pode apontar para um
  // objetivo novo (ex.: começar só no mês seguinte). Meta e data também vêm antes:
  // o aporte que vem a seguir já completa a meta nova.
  for (const n of s.newGoals ?? [])
    goals.push({
      id: n.id, name: n.name, status: "active", location: null, target: n.target, saved: n.saved,
      deadlineMonth: n.deadlineMonth, priority: Math.max(0, ...goals.map((g) => g.priority)) + 1,
      plans: [{ month: input.startMonth, planned: n.monthly }],
    });
  for (const e of s.goalEdits ?? [])
    goals = goals.map((g) => (g.id === e.goalId ? { ...g, target: e.target, deadlineMonth: e.deadlineMonth } : g));
  for (const c of s.contributions ?? []) setRange(c.goalId, c.fromMonth, c.months, c.cents);
  for (const p of s.pauses ?? []) setRange(p.goalId, p.fromMonth, p.months, 0n);

  const premises = [...(input.premises ?? [])];
  const cards = input.cards.map((c) => ({
    ...c, bills: [...c.bills], installments: [...c.installments], recurring: [...c.recurring],
  }));
  (s.purchases ?? []).forEach((p, idx) => {
    const card = cards.find((c) => c.card === p.card) ?? cards[0];
    if (!card) return;
    try {
      const schedule = cardPurchaseSchedule({ cents: p.cents, day: p.day, installments: p.installments, cycles: card.cycles });
      const last = schedule[schedule.length - 1].dueMonth;
      for (const part of schedule) {
        card.installments.push({
          key: `sim:${idx}`, label: p.label ?? "Compra simulada", cents: part.cents,
          k: part.k, n: schedule.length, month: part.dueMonth, lastMonth: last,
        });
        const i = card.bills.findIndex((b) => b.month === part.dueMonth);
        if (i >= 0) card.bills[i] = { ...card.bills[i], total: card.bills[i].total + part.cents };
        else card.bills.push({ month: part.dueMonth, total: part.cents, quality: "estimated", source: "estimado" });
      }
    } catch (e) {
      premises.push(`Compra simulada ignorada: ${(e as Error).message}`);
    }
  });

  let fixed = input.fixed;
  for (const e of s.fixedEdits ?? [])
    fixed = fixed.map((m) => {
      if (m.month < e.fromMonth || !m.items.some((l) => l.label === e.label)) return m;
      const items = m.items.map((l) =>
        l.label !== e.label
          ? l
          : {
              ...l,
              ...(e.cents !== undefined ? { cents: e.cents } : {}),
              ...(e.day !== undefined ? { date: dayOf(m.month, e.day) } : {}),
            },
      );
      return { ...m, items, cents: items.reduce((t, l) => t + l.cents, 0n) };
    });

  return {
    ...input,
    fixed,
    goals,
    cards,
    premises,
    shocks: [...(input.shocks ?? []), ...(s.shocks ?? [])],
    everyday: s.everydayWeekly !== undefined ? { weekly: s.everydayWeekly, source: "declarado" } : input.everyday,
    freedTo: s.freedTo ?? input.freedTo,
  };
}

export function describeScenario(base: FutureInput, s: Scenario): string[] {
  const out: string[] = [];
  const name = (id: string) => base.goals.find((g) => g.id === id)?.name ?? "Objetivo";
  for (const e of s.goalEdits ?? [])
    out.push(`${name(e.goalId)}: meta de ${reais(e.target)}${e.deadlineMonth ? ` até ${monthShort(e.deadlineMonth)}` : ""}`);
  for (const c of s.contributions ?? [])
    out.push(
      `${name(c.goalId)}: aporte de ${reais(c.cents)}/mês ${c.months === null ? `a partir de ${monthShort(c.fromMonth)}` : c.months === 1 ? `em ${monthShort(c.fromMonth)}` : `de ${monthShort(c.fromMonth)} a ${monthShort(shiftMonth(c.fromMonth, c.months - 1))}`}`,
    );
  for (const p of s.pauses ?? [])
    out.push(`${name(p.goalId)}: pausa de ${monthShort(p.fromMonth)} a ${monthShort(shiftMonth(p.fromMonth, p.months - 1))}`);
  for (const n of s.newGoals ?? [])
    out.push(`Novo objetivo: ${n.name}, meta de ${reais(n.target)}, aporte de ${reais(n.monthly)}/mês`);
  for (const p of s.purchases ?? [])
    out.push(`Compra no cartão: ${p.label ?? "compra"}, ${p.installments}× de ${reais(p.cents / BigInt(p.installments))}`);
  for (const k of s.shocks ?? [])
    out.push(
      k.kind === "despesa"
        ? `Imprevisto de ${reais(k.cents)} em ${monthShort(k.month)}`
        : `Receita ${reais(k.cents)} menor por ${plural(k.months, "mês", "meses")} desde ${monthShort(k.month)}`,
    );
  if (s.everydayWeekly !== undefined)
    out.push(`Dia a dia: ${reais(base.everyday.weekly ?? 0n)} → ${reais(s.everydayWeekly)} por semana`);
  if (s.freedTo === "objetivos") out.push("Valor de parcela que termina segue para os objetivos");
  return out;
}

// ------------------------------------------------------------------ comparação

function monthDelta(a: string | null, b: string | null): { sense: number; delta?: string } {
  if (a === b) return { sense: 0 };
  if (a === null) return { sense: 1, delta: "passa a acontecer" };
  if (b === null) return { sense: -1, delta: "sai do horizonte" };
  const d = monthsBetween(a, b);
  const n = Math.abs(d);
  return { sense: d < 0 ? 1 : -1, delta: `${d < 0 ? "−" : "+"}${n} ${n === 1 ? "mês" : "meses"}` };
}

export function compareFuture(
  a: FutureResult,
  b: FutureResult,
  horizon: number,
  names: Record<string, string> = {},
): DiffItem[] {
  const out: DiffItem[] = [];
  const when = (m: string | null) => (m === null ? "fora do horizonte" : monthShort(m));
  for (const [id, after] of Object.entries(b.reach)) {
    const before = id in a.reach ? a.reach[id] : null;
    const md = monthDelta(before, after);
    if (md.sense !== 0 || !(id in a.reach))
      out.push({ id: "g-" + id, label: `${names[id] ?? "Objetivo"} completa`, before: id in a.reach ? when(before) : "—", after: when(after), ...md });
  }
  const ra = a.rows.slice(0, horizon);
  const rb = b.rows.slice(0, horizon);
  const fa = ra[0].free, fb = rb[0].free;
  if (fa !== fb)
    out.push({ id: "free", label: `Folga livre em ${monthShort(ra[0].month)}`, before: reais(fa), after: reais(fb), sense: fb > fa ? 1 : -1, delta: signed(fb - fa) });
  const minOf = (rows: FutureRow[], f: (r: FutureRow) => bigint) => rows.reduce((m, r) => min(m, f(r)), f(rows[0]));
  const minA = minOf(ra, (r) => r.free), minB = minOf(rb, (r) => r.free);
  if (minA !== minB)
    out.push({ id: "min", label: "Mês mais apertado", before: reais(minA), after: reais(minB), sense: minB > minA ? 1 : -1, delta: signed(minB - minA) });
  const bankA = minOf(ra, (r) => r.bank), bankB = minOf(rb, (r) => r.bank);
  if (bankA !== bankB)
    out.push({ id: "bank", label: "Menor saldo em conta", before: reais(bankA), after: reais(bankB), sense: bankB > bankA ? 1 : -1, delta: signed(bankB - bankA) });
  const na = ra[ra.length - 1].netWorth, nb = rb[rb.length - 1].netWorth;
  if (na !== nb)
    out.push({ id: "nw", label: `Patrimônio em ${monthShort(ra[ra.length - 1].month)}`, before: reais(na), after: reais(nb), sense: nb > na ? 1 : -1, delta: signed(nb - na) });
  return out;
}
