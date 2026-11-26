import type {
  CardBill,
  CardFuture,
  CardInstallment,
  CardPart,
  Decision,
  FutureInput,
  FutureResult,
  FutureRow,
  GoalFuture,
  Line,
  MonthAmount,
  Scenario,
  Shock,
} from "../../src/domain/future-months.ts";

// O servidor manda bigint como texto (Wire<T>). O navegador precisa de bigint
// de volta para rodar projectFuture. Cada campo bigint é listado à mão: um
// rótulo numérico ("2027") nunca vira número por engano.

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw new Error(`Esperava um objeto em ${path}.`);
  return v as Obj;
}
function list(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`Esperava uma lista em ${path}.`);
  return v;
}
function big(v: unknown, path: string): bigint {
  if (typeof v !== "string" || !/^-?\d+$/.test(v))
    throw new Error(`Valor inválido em ${path}: esperava centavos em texto.`);
  return BigInt(v);
}
function bigOrNull(v: unknown, path: string): bigint | null {
  return v === null ? null : big(v, path);
}
function bigMap(v: unknown, path: string): Record<string, bigint> {
  return Object.fromEntries(
    Object.entries(obj(v, path)).map(([k, x]) => [k, big(x, `${path}.${k}`)]),
  );
}
function each<T>(v: unknown, path: string, f: (item: Obj, at: string) => T): T[] {
  return list(v, path).map((item, i) => f(obj(item, `${path}[${i}]`), `${path}[${i}]`));
}

function line(o: Obj, at: string): Line {
  return { ...(o as unknown as Line), cents: big(o.cents, `${at}.cents`) };
}
function monthAmount(o: Obj, at: string): MonthAmount {
  return {
    ...(o as unknown as MonthAmount),
    cents: big(o.cents, `${at}.cents`),
    items: each(o.items, `${at}.items`, line),
  };
}
function card(o: Obj, at: string): CardFuture {
  return {
    ...(o as unknown as CardFuture),
    bills: each(o.bills, `${at}.bills`, (b, p) => ({
      ...(b as unknown as CardBill),
      total: big(b.total, `${p}.total`),
      ...(b.leftoverCategories !== undefined
        ? {
            leftoverCategories: each(b.leftoverCategories, `${p}.leftoverCategories`, (c, q) => ({
              ...(c as unknown as { name: string; cents: bigint }),
              cents: big(c.cents, `${q}.cents`),
            })),
          }
        : {}),
    })),
    installments: each(o.installments, `${at}.installments`, (b, p) => ({
      ...(b as unknown as CardInstallment),
      cents: big(b.cents, `${p}.cents`),
    })),
    recurring: each(o.recurring, `${at}.recurring`, (b, p) => ({
      ...(b as unknown as CardFuture["recurring"][number]),
      cents: big(b.cents, `${p}.cents`),
    })),
  };
}
function goal(o: Obj, at: string): GoalFuture {
  return {
    ...(o as unknown as GoalFuture),
    target: big(o.target, `${at}.target`),
    saved: big(o.saved, `${at}.saved`),
    plans: each(o.plans, `${at}.plans`, (p, q) => ({
      month: p.month as string,
      planned: big(p.planned, `${q}.planned`),
    })),
  };
}
function shock(o: Obj, at: string): Shock {
  return { ...(o as unknown as Shock), cents: big(o.cents, `${at}.cents`) };
}

export function decodeFutureInput(wire: unknown): FutureInput {
  const o = obj(wire, "input");
  const everyday = obj(o.everyday, "input.everyday");
  const input: FutureInput = {
    ...(o as unknown as FutureInput),
    startBalance: big(o.startBalance, "input.startBalance"),
    income: each(o.income, "input.income", monthAmount),
    fixed: each(o.fixed, "input.fixed", monthAmount),
    ...(o.paidFixed === undefined ? {} : { paidFixed: each(o.paidFixed, "input.paidFixed", monthAmount) }),
    everyday: {
      ...(everyday as unknown as FutureInput["everyday"]),
      weekly: bigOrNull(everyday.weekly, "input.everyday.weekly"),
    },
    cards: each(o.cards, "input.cards", card),
    goals: each(o.goals, "input.goals", goal),
    essentialsMonthly: big(o.essentialsMonthly, "input.essentialsMonthly"),
  };
  if (o.shocks !== undefined) input.shocks = each(o.shocks, "input.shocks", shock);
  if (o.signals !== undefined) {
    const signals = obj(o.signals, "input.signals");
    input.signals = {
      categories: each(signals.categories, "input.signals.categories", (c, p) => ({
        name: c.name as string,
        cents: big(c.cents, `${p}.cents`),
        prev: bigOrNull(c.prev, `${p}.prev`),
        budget: bigOrNull(c.budget, `${p}.budget`),
      })),
      ...(signals.history === undefined
        ? {}
        : {
            history:
              signals.history === null
                ? null
                : {
                    avg: big(obj(signals.history, "input.signals.history").avg, "input.signals.history.avg"),
                    kept: each(obj(signals.history, "input.signals.history").kept, "input.signals.history.kept", (k, p) => ({
                      month: k.month as string,
                      cents: big(k.cents, `${p}.cents`),
                    })),
                  },
          }),
    };
  }
  return input;
}

function scenario(o: Obj, at: string): Scenario {
  const out: Scenario = { ...(o as unknown as Scenario) };
  if (o.contributions !== undefined)
    out.contributions = each(o.contributions, `${at}.contributions`, (c, p) => ({
      ...(c as unknown as NonNullable<Scenario["contributions"]>[number]),
      cents: big(c.cents, `${p}.cents`),
    }));
  if (o.newGoals !== undefined)
    out.newGoals = each(o.newGoals, `${at}.newGoals`, (c, p) => ({
      ...(c as unknown as NonNullable<Scenario["newGoals"]>[number]),
      target: big(c.target, `${p}.target`),
      saved: big(c.saved, `${p}.saved`),
      monthly: big(c.monthly, `${p}.monthly`),
    }));
  if (o.purchases !== undefined)
    out.purchases = each(o.purchases, `${at}.purchases`, (c, p) => ({
      ...(c as unknown as NonNullable<Scenario["purchases"]>[number]),
      cents: big(c.cents, `${p}.cents`),
    }));
  if (o.shocks !== undefined) out.shocks = each(o.shocks, `${at}.shocks`, shock);
  if (o.everydayWeekly !== undefined) out.everydayWeekly = big(o.everydayWeekly, `${at}.everydayWeekly`);
  return out;
}

function part(o: Obj, at: string): CardPart {
  return { ...(o as unknown as CardPart), cents: big(o.cents, `${at}.cents`) };
}
function row(o: Obj, at: string): FutureRow {
  return {
    ...(o as unknown as FutureRow),
    preCard: big(o.preCard, `${at}.preCard`),
    card: big(o.card, `${at}.card`),
    budget: big(o.budget, `${at}.budget`),
    shocks: big(o.shocks, `${at}.shocks`),
    goalIn: bigMap(o.goalIn, `${at}.goalIn`),
    goalBal: bigMap(o.goalBal, `${at}.goalBal`),
    free: big(o.free, `${at}.free`),
    bank: big(o.bank, `${at}.bank`),
    reserves: big(o.reserves, `${at}.reserves`),
    committed: big(o.committed, `${at}.committed`),
    netWorth: big(o.netWorth, `${at}.netWorth`),
    cardParts: each(o.cardParts, `${at}.cardParts`, (c, p) => ({
      card: c.card as string,
      parts: each(c.parts, `${p}.parts`, part),
    })),
    cash: monthCash(o.cash as Obj, `${at}.cash`),
  };
}
function monthCash(o: Obj, at: string): FutureRow["cash"] {
  const low = o.low as Obj;
  return {
    from: o.from as string,
    to: o.to as string,
    opening: big(o.opening, `${at}.opening`),
    closing: big(o.closing, `${at}.closing`),
    everydayPerDay: big(o.everydayPerDay, `${at}.everydayPerDay`),
    everydayOnCard: big(o.everydayOnCard, `${at}.everydayOnCard`),
    events: each(o.events, `${at}.events`, (e, p) => ({
      ...(e as unknown as FutureRow["cash"]["events"][number]),
      cents: big(e.cents, `${p}.cents`),
      balance: big(e.balance, `${p}.balance`),
    })),
    low: { date: low.date as string, cents: big(low.cents, `${at}.low.cents`) },
  };
}
function decision(o: Obj, at: string): Decision {
  const out = { ...(o as unknown as Decision) };
  if (o.metric !== undefined) out.metric = big(o.metric, `${at}.metric`);
  if (o.action !== undefined) {
    const action = obj(o.action, `${at}.action`);
    out.action = {
      label: action.label as string,
      scenario: scenario(obj(action.scenario, `${at}.action.scenario`), `${at}.action.scenario`),
    };
  }
  // O que dá para ajustar antes de testar: só `cents` é bigint (goalId/fromMonth são texto).
  if (o.edit !== undefined) {
    const edit = obj(o.edit, `${at}.edit`);
    out.edit = { ...(edit as unknown as NonNullable<Decision["edit"]>), cents: big(edit.cents, `${at}.edit.cents`) };
  }
  return out;
}

export function decodeFutureResult(wire: unknown): FutureResult {
  const o = obj(wire, "result");
  return {
    ...(o as unknown as FutureResult),
    rows: each(o.rows, "result.rows", row),
    conflicts: each(o.conflicts, "result.conflicts", (c, p) => ({
      month: c.month as string,
      cents: big(c.cents, `${p}.cents`),
      cause: c.cause as string,
    })),
    decisions: each(o.decisions, "result.decisions", decision),
  };
}

function stringify(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(stringify);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stringify(v)]));
  return value;
}

/** Inverso de decodeFutureInput (para testes e para a vitrine). */
export function encodeFutureInput(input: FutureInput): unknown {
  return stringify(input);
}
