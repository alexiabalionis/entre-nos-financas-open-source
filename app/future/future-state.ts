import type { FutureInput, Scenario } from "../../src/domain/future-months.ts";

// Estado do Futuro: o plano salvo (do servidor), o rascunho (simulação local) e
// o recorte da tela. Lógica pura: o hook só liga isto à API.

export type Months = 3 | 6 | 12 | 24 | 36;
export type ListName = "goalEdits" | "contributions" | "pauses" | "newGoals" | "purchases" | "shocks";

export type FutureState = {
  /** Salvo (do servidor). */
  input: FutureInput | null;
  /** Rascunho; {} = sem mudanças. */
  scenario: Scenario;
  months: Months;
  /** Índice do mês selecionado. */
  selected: number;
};

export type FutureAction =
  | { type: "loaded"; input: FutureInput }
  | { type: "setMonths"; months: Months }
  | { type: "select"; index: number }
  | { type: "patch"; patch: Partial<Scenario> }
  | { type: "replace"; scenario: Scenario }
  | { type: "remove"; list: ListName; key: string }
  | { type: "discard" };

export const initialState = (months: Months = 24): FutureState => ({
  input: null,
  scenario: {},
  months,
  selected: 0,
});

// Chave de cada item de lista: é por ela que um novo item substitui o antigo.
const keyOf = {
  goalEdits: (x: NonNullable<Scenario["goalEdits"]>[number]) => x.goalId,
  contributions: (x: NonNullable<Scenario["contributions"]>[number]) => x.goalId,
  pauses: (x: NonNullable<Scenario["pauses"]>[number]) => x.goalId,
  newGoals: (x: NonNullable<Scenario["newGoals"]>[number]) => x.id,
  purchases: (x: NonNullable<Scenario["purchases"]>[number]) => x.label ?? "",
  shocks: (x: NonNullable<Scenario["shocks"]>[number]) => x.label,
};

function mergeList<T>(
  old: T[] | undefined,
  add: T[] | undefined,
  key: (t: T) => string,
  drop: (t: T) => boolean = () => false,
): T[] | undefined {
  if (!add) return old;
  const keys = new Set(add.map(key));
  const next = [...(old ?? []).filter((t) => !keys.has(key(t))), ...add.filter((t) => !drop(t))];
  return next.length ? next : undefined;
}

function setList<K extends ListName>(out: Scenario, name: K, value: Scenario[K]) {
  if (value === undefined || (value as unknown[]).length === 0) delete out[name];
  else out[name] = value;
}

function applyPatch(s: Scenario, p: Partial<Scenario>): Scenario {
  const out: Scenario = { ...s };
  // Contribuição de valor zero (drop) tira a entrada que já existia para o objetivo.
  setList(out, "contributions", mergeList(s.contributions, p.contributions, keyOf.contributions, (c) => c.cents === 0n));
  setList(out, "pauses", mergeList(s.pauses, p.pauses, keyOf.pauses));
  setList(out, "goalEdits", mergeList(s.goalEdits, p.goalEdits, keyOf.goalEdits));
  setList(out, "newGoals", mergeList(s.newGoals, p.newGoals, keyOf.newGoals));
  setList(out, "purchases", mergeList(s.purchases, p.purchases, keyOf.purchases));
  setList(out, "shocks", mergeList(s.shocks, p.shocks, keyOf.shocks));
  if ("everydayWeekly" in p) {
    if (p.everydayWeekly === undefined) delete out.everydayWeekly;
    else out.everydayWeekly = p.everydayWeekly;
  }
  if ("freedTo" in p) {
    if (p.freedTo === undefined) delete out.freedTo;
    else out.freedTo = p.freedTo;
  }
  return out;
}

function removeItem(s: Scenario, list: ListName, key: string): Scenario {
  const items = (s[list] ?? []) as unknown[];
  const fn = keyOf[list] as (x: never) => string;
  const out: Scenario = { ...s };
  setList(out, list, items.filter((x) => fn(x as never) !== key) as never);
  return out;
}

// Recarregar mantém a simulação, mas tira o que aponta para objetivo que sumiu.
function clean(s: Scenario, input: FutureInput): Scenario {
  const ids = new Set([...input.goals.map((g) => g.id), ...(s.newGoals ?? []).map((g) => g.id)]);
  const out: Scenario = { ...s };
  setList(out, "contributions", s.contributions?.filter((c) => ids.has(c.goalId)));
  setList(out, "pauses", s.pauses?.filter((c) => ids.has(c.goalId)));
  setList(out, "goalEdits", s.goalEdits?.filter((c) => ids.has(c.goalId)));
  return out;
}

const clamp = (i: number, months: number) => Math.max(0, Math.min(months - 1, Math.trunc(i)));

export function futureReducer(s: FutureState, a: FutureAction): FutureState {
  switch (a.type) {
    case "loaded":
      return { ...s, input: a.input, scenario: clean(s.scenario, a.input) };
    case "setMonths":
      return { ...s, months: a.months, selected: clamp(s.selected, a.months) };
    case "select":
      return { ...s, selected: clamp(a.index, s.months) };
    case "patch":
      return { ...s, scenario: applyPatch(s.scenario, a.patch) };
    case "replace":
      return { ...s, scenario: a.scenario };
    case "remove":
      return { ...s, scenario: removeItem(s.scenario, a.list, a.key) };
    case "discard":
      return { ...s, scenario: {} };
  }
}

const LISTS: ListName[] = ["goalEdits", "contributions", "pauses", "newGoals", "purchases", "shocks"];

/** Algum campo não vazio. */
export function isDirty(s: Scenario): boolean {
  return changeCount(s) > 0;
}

/** Soma dos itens das listas e um por campo escalar definido. */
export function changeCount(s: Scenario): number {
  return (
    LISTS.reduce((n, l) => n + (s[l]?.length ?? 0), 0) +
    (s.everydayWeekly !== undefined ? 1 : 0) +
    (s.freedTo !== undefined ? 1 : 0)
  );
}

// ------------------------------------------------------------------ salvar

const monthIndex = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
function addMonths(month: string, n: number): string {
  const t = monthIndex(month) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function planAt(plans: readonly { month: string; planned: bigint }[], month: string): bigint {
  let best: { month: string; planned: bigint } | null = null;
  for (const p of plans) if (p.month <= month && (!best || p.month > best.month)) best = p;
  return best?.planned ?? 0n;
}

export type PlanWrite = { goal_id: string; from_month: string; months: number; cents: bigint };

/**
 * Chamadas a reserves/plan-range que gravam o rascunho como plano: aportes e
 * pausas de objetivos que já existem. Um aporte com fim (months) é seguido de
 * um plano que devolve o valor de antes no mês seguinte, senão o último plano
 * gravado seguiria valendo. Objetivo novo e simulações (compra, imprevisto, dia
 * a dia) não são plano e ficam de fora.
 */
export function planWrites(input: FutureInput, scenario: Scenario): PlanWrite[] {
  const lastMonth = addMonths(input.startMonth, input.months - 1);
  const out: PlanWrite[] = [];
  const add = (goalId: string, from: string, months: number | null, cents: bigint) => {
    const goal = input.goals.find((g) => g.id === goalId);
    if (!goal) return;
    const span = months ?? Math.max(1, monthIndex(lastMonth) - monthIndex(from) + 1);
    out.push({ goal_id: goalId, from_month: from, months: Math.min(36, span), cents });
    if (months === null) return;
    const end = addMonths(from, months);
    const restore = planAt(goal.plans, end);
    if (!goal.plans.some((p) => p.month === end) && restore !== cents)
      out.push({ goal_id: goalId, from_month: end, months: 1, cents: restore });
  };
  for (const c of scenario.contributions ?? []) add(c.goalId, c.fromMonth, c.months, c.cents);
  for (const p of scenario.pauses ?? []) add(p.goalId, p.fromMonth, p.months, 0n);
  return out;
}
