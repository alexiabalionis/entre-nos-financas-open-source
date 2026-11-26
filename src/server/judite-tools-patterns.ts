// Ferramenta padroes (SPEC-JUDITE-VISAO-AMPLA, Parte 2): liga o domínio puro
// de padrões ao laço de ferramentas. Lê as compras pela MESMA leitura de
// detalhar_categoria, junta hora e parcela do banco, as datas de salário e a
// renda média, e devolve só os destaques (dinheiro em centavos como texto).
// Nenhuma soma de gasto nova: tudo que é número sai do domínio.
import { shiftMonth } from "../domain/card-cycle.ts";
import { addDays } from "../domain/day.ts";
import { averageFlows } from "../domain/insights.ts";
import { moneyIn, type Period } from "../domain/money-check.ts";
import { merchantKey } from "../domain/merchant-key.ts";
import { promptLabel, type Movement } from "../domain/movements.ts";
import {
  findPatterns,
  LIMITS,
  timeQuality,
  type AnalysisId,
  type Highlight,
  type Payment,
  type Purchase,
  type Recorte,
  type TimeQuality,
} from "../domain/spend-patterns.ts";
import { PatternTrace, overlaps, selectionTrace } from "../domain/spend-patterns-trace.ts";
import { settledToday } from "./bank-settled.ts";
import { asUser } from "./db.ts";
import { UserError } from "./imports.ts";
import { patternTraceEnabled, writePatternTrace } from "./judite-patterns-trace.ts";
import { readExpensePurchases } from "./judite-tools-movements.ts";
import type { ToolCall, ToolDeps } from "./judite-tools-schema.ts";

const DEFAULT_MONTHS = 6;
const MIN_MONTHS = 3;
const MAX_HIGHLIGHTS = 8;
const MAX_HIGHLIGHTS_FILTERED = 5;
// Do mais específico ao mais geral: o recorte que fica quando o mesmo padrão aparece em vários.
const SPECIFICITY: readonly Recorte[] = ["lugar", "etiqueta", "categoria", "conta", "pagamento", "casa"];
// Análises cujas "metades" são dinheiro por mês (centavos); nas outras são índice, parte ou contagem.
const MONEY_HALVES: ReadonlySet<AnalysisId> = new Set(["tendencia", "compras_pequenas"]);

type Call = Extract<ToolCall, { name: "padroes" }>;
type BankMeta = { at: string | null; installment: number | null; installments: number | null };

const AT = `to_char(bt.transaction_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** Janela de meses fechados: os últimos `n` antes do atual. */
function closedWindow(n: number) {
  const current = settledToday().slice(0, 7);
  const months = Array.from({ length: n }, (_, k) => shiftMonth(current, k - n));
  return { months, de: `${months[0]}-01`, ate: addDays(`${current}-01`, -1) };
}

export type Extras = {
  meta: Map<string, BankMeta>;
  accountsTime: Record<string, TimeQuality>;
  salaryDates: string[];
  essentialNames: Set<string>;
};

export async function readExtras(deps: ToolDeps, rows: readonly Movement[], de: string, ate: string): Promise<Extras> {
  const bankIds = rows.filter((r) => r.id.startsWith("bankpending:")).map((r) => r.id.slice("bankpending:".length));
  const eventIds = rows.filter((r) => r.id.startsWith("event:")).map((r) => r.id.slice("event:".length));
  const family = deps.user.familyId;
  const protectedNames = (await deps.everyday()).protectedNames;
  return asUser(deps.db, deps.user.userId, async (tx) => {
    const metaRows = await tx.query<{ id: string; event_id: string | null; at: string | null; n: string | null; total: string | null }>(
      `SELECT bt.id::text AS id, bt.event_id::text AS event_id, ${AT} AS at,
              bt.card_meta->>'installment_number' AS n, bt.card_meta->>'total_installments' AS total
         FROM bank_transactions bt
        WHERE bt.household_id=$1 AND (bt.id = ANY($2::uuid[]) OR bt.event_id = ANY($3::uuid[]))
        ORDER BY bt.created_at, bt.id`,
      [family, bankIds, eventIds],
    );
    const meta = new Map<string, BankMeta>();
    const num = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);
    for (const m of metaRows.rows) {
      const value = { at: m.at, installment: num(m.n), installments: num(m.total) };
      meta.set(`bankpending:${m.id}`, value);
      if (m.event_id && !meta.has(`event:${m.event_id}`)) meta.set(`event:${m.event_id}`, value);
    }
    const times = await tx.query<{ name: string; at: string }>(
      `SELECT a.name, ${AT} AS at
         FROM bank_transactions bt JOIN accounts a ON a.household_id=bt.household_id AND a.id=bt.local_account_id
        WHERE bt.household_id=$1 AND bt.transaction_at IS NOT NULL AND bt.transaction_date BETWEEN $2::date AND $3::date`,
      [family, de, ate],
    );
    const byAccount = new Map<string, string[]>();
    for (const t of times.rows) byAccount.set(t.name, [...(byAccount.get(t.name) ?? []), t.at]);
    const accountsTime = Object.fromEntries([...byAccount].map(([name, list]) => [name, timeQuality(list)]));
    // Salário: a renda principal (maior valor esperado) das regras de renda; a data é a do
    // crédito reconhecido no banco ou, sem ele, a esperada. Um ciclo a mais para o último corte.
    const salary = await tx.query<{ day: string }>(
      `SELECT COALESCE(bt.transaction_date, o.expected_date)::text AS day
         FROM recurrence_occurrences o
         JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
         LEFT JOIN bank_transactions bt ON bt.household_id=o.household_id AND bt.id=o.match_bank_transaction_id
        WHERE o.household_id=$1 AND r.purpose='income' AND NOT r.paused
          AND r.id = (SELECT id FROM recurrences WHERE household_id=$1 AND purpose='income' AND NOT paused
                       ORDER BY expected_cents DESC, created_at, id LIMIT 1)
          AND COALESCE(bt.transaction_date, o.expected_date) BETWEEN $2::date AND $3::date
        ORDER BY 1`,
      [family, de, addDays(ate, 45)],
    );
    const essential = await tx.query<{ name: string }>("SELECT name FROM categories WHERE household_id=$1 AND essential", [family]);
    return {
      meta,
      accountsTime,
      salaryDates: salary.rows.map((s) => s.day),
      essentialNames: new Set([...protectedNames, ...essential.rows.map((c) => c.name)]),
    };
  });
}

/** Compra do domínio a partir de uma linha da leitura compartilhada. */
export function toPurchase(
  r: Movement,
  extras: Pick<Extras, "meta" | "essentialNames">,
  kinds: ReadonlyMap<string, string>,
): Purchase {
  const bank = extras.meta.get(r.id);
  const label = promptLabel(r);
  const isCard = r.cardLabel !== undefined || kinds.get(r.account) === "card";
  const payment: Payment = isCard ? "credito" : /^pix\b/i.test(label) || /\bpix\b/i.test(r.description) ? "pix" : "debito";
  const installment = bank?.installments !== null && bank?.installments !== undefined && bank.installments > 1;
  const category = r.category ?? "Sem categoria";
  return {
    id: r.id,
    date: r.date,
    at: bank?.at ?? null,
    cents: -BigInt(r.amount),
    label,
    category,
    tag: r.tag ?? "Sem etiqueta",
    account: r.account,
    ...(isCard ? { card: r.cardLabel ?? r.account } : {}),
    payment,
    type: r.fixed ? "fixa" : installment ? "parcela" : r.scheduled ? "agendado" : "avulso",
    essential: extras.essentialNames.has(category),
    installmentStart: installment && bank?.installment === 1,
  };
}

/** Mantém, entre destaques do mesmo padrão e da mesma base de compras, o recorte mais específico. */
export function dedupHighlights(list: readonly Highlight[]): Highlight[] {
  const rank = (h: Highlight) => SPECIFICITY.indexOf(h.recorte.tipo);
  const best = new Map<string, Highlight>();
  for (const h of list) {
    const key = [h.analise, h.corte, h.base.corte_compras, h.base.corte_cents].join("\u0000");
    const kept = best.get(key);
    if (!kept || rank(h) < rank(kept)) best.set(key, h);
  }
  return list.filter((h) => best.get([h.analise, h.corte, h.base.corte_compras, h.base.corte_cents].join("\u0000")) === h);
}

const round = (n: number) => Math.round(n * 100) / 100;
const str = (v: bigint | number) => (typeof v === "bigint" ? v : BigInt(Math.trunc(v))).toString();

function highlightWire(h: Highlight, ref: string) {
  const halves = h.metades;
  return {
    ref,
    analise: h.analise,
    recorte: { tipo: h.recorte.tipo, chave: h.recorte.chave },
    corte: h.corte,
    base: {
      corte_compras: h.base.corte_compras,
      corte_cents: str(h.base.corte_cents),
      recorte_compras: h.base.recorte_compras,
      recorte_cents: str(h.base.recorte_cents),
    },
    indice: h.indice === null ? null : round(h.indice),
    metades: !halves
      ? null
      : MONEY_HALVES.has(h.analise)
        ? { anterior_cents: str(halves[0]), recente_cents: str(halves[1]) }
        : { anterior: round(halves[0]), recente: round(halves[1]) },
    alavancas: h.alavancas.map((l) => ({ tipo: l.tipo, cents: str(l.cents) })),
    em_jogo_cents: str(h.em_jogo_cents),
    em_jogo_natureza: h.em_jogo_natureza,
  };
}

/** Tudo que padroes e investigar_gastos leem de uma janela: carregado uma vez por pergunta. */
export type SpendData = {
  window: { months: string[]; de: string; ate: string };
  rows: Movement[];
  withSpend: Set<string>;
  /** Meses da janela a partir do primeiro com gasto. */
  months: string[];
  extras: Extras;
  kinds: Map<string, string>;
  /** Todas as compras da janela, já no formato do domínio (mesma ordem de rows). */
  purchases: Purchase[];
  /** Pix e transferência enviados: id da compra → destinatário opaco (d0, d1...). */
  recipients: Map<string, string>;
};

/** d0, d1... do destinatário de um Pix ou transferência enviados (estável na pergunta pelo mapa); null nas outras linhas. */
export function recipientRef(r: Movement, refs: Map<string, string>): string | null {
  if (!/^(Pix|Transferência) enviad/.test(promptLabel({ ...r, aliasName: null }))) return null;
  const key = merchantKey(r.description);
  if (!key) return null;
  if (!refs.has(key)) refs.set(key, `d${refs.size}`);
  return refs.get(key)!;
}

export async function loadSpend(deps: ToolDeps, n: number, recipientRefs: Map<string, string>): Promise<SpendData> {
  const window = closedWindow(n);
  const rows = await readExpensePurchases(deps, window);
  const withSpend = new Set(rows.filter((r) => BigInt(r.amount) < 0n).map((r) => r.date.slice(0, 7)));
  const first = window.months.findIndex((m) => withSpend.has(m));
  const months = first < 0 ? [] : window.months.slice(first);
  const extras = await readExtras(deps, rows, window.de, window.ate);
  const kinds = new Map(deps.catalog.accounts.map((a) => [a.name, a.kind]));
  const purchases = rows.map((r) => toPurchase(r, extras, kinds));
  const recipients = new Map<string, string>();
  for (const r of rows) {
    const ref = recipientRef(r, recipientRefs);
    if (ref) recipients.set(r.id, ref);
  }
  return { window, rows, withSpend, months, extras, kinds, purchases, recipients };
}

export async function patternsTool(deps: ToolDeps, call: Call): Promise<unknown> {
  const pick = (list: { name: string }[] | undefined, ref: string | undefined, what: string) => {
    if (ref === undefined) return undefined;
    const found = list?.[Number(ref.slice(1))];
    if (!found) throw new UserError(`Não identifiquei ${what}. Diga o nome exato.`);
    return found.name;
  };
  const category = pick(deps.catalog.categories, call.categoria, "a categoria");
  const account = pick(deps.catalog.accounts, call.conta, "a conta");
  const data = await deps.spend(call.meses ?? DEFAULT_MONTHS);
  const { window, rows, withSpend, months, extras } = data;
  const first = window.months.findIndex((m) => withSpend.has(m));
  const trace = patternTraceEnabled() ? new PatternTrace() : undefined;
  const universe = {
    pedido: { categoria: category ?? null, conta: account ?? null, meses: call.meses ?? DEFAULT_MONTHS },
    janela: window,
    linhas_lidas: rows.length,
    meses_com_gasto: [...withSpend].sort(),
    meses_analisados: months,
    meses_sem_gasto_no_inicio: first < 0 ? window.months : window.months.slice(0, first),
  };
  if (months.filter((m) => withSpend.has(m)).length < MIN_MONTHS) {
    if (trace) await writePatternTrace({ universo: universe, motivo: "insufficient_months", resposta: null });
    throw new UserError("Ainda não há 3 meses fechados com gastos para procurar padrões.");
  }
  const purchases = data.purchases.filter(
    (_p, k) => (category === undefined || rows[k]!.category === category) && (account === undefined || rows[k]!.account === account || rows[k]!.cardLabel === account),
  );
  const income = averageFlows((await deps.everyday()).months.filter((m) => months.includes(m.month)));
  const result = findPatterns({
    purchases,
    accountsTime: extras.accountsTime,
    salaryDates: extras.salaryDates,
    months,
    incomeAvgCents: income?.avgIn ?? null,
    maxDestaques: 100_000,
    ...(trace ? { trace } : {}),
  });
  const filtered = category !== undefined || account !== undefined;
  const deduped = dedupHighlights(result.destaques);
  const highlights = deduped.slice(0, filtered ? MAX_HIGHLIGHTS_FILTERED : MAX_HIGHLIGHTS);
  // Etiquetas p0, p1... valem para a pergunta toda: uma segunda chamada continua a contagem.
  const refs = highlights.map((h) => {
    const ref = `p${[...deps.patternRefs.keys()].filter((k) => k.startsWith("p")).length}`;
    deps.patternRefs.set(ref, { analise: h.analise, corte: h.corte, recorte: h.recorte, ...(h.ids ? { ids: h.ids } : {}) });
    return ref;
  });
  const out = {
    periodo: result.periodo,
    meses: result.meses,
    unidades:
      "base = total do período inteiro; alavancas, em_jogo e metades em dinheiro = por mês. Só alavancas é dinheiro que uma mudança pode devolver; em_jogo_natureza diz o que em_jogo é (diferenca_historica e movimentado não são economia)",
    compras_analisadas: result.compras_analisadas,
    cobertura_hora: round(result.cobertura_hora),
    ciclo_salario: result.ciclo_salario,
    ...(filtered ? { filtros: { ...(category ? { categoria: category } : {}), ...(account ? { conta: account } : {}) } } : {}),
    destaques: highlights.map((h, i) => highlightWire(h, refs[i]!)),
    sem_padrao: result.sem_padrao,
  };
  if (trace) {
    const byType: Record<string, number> = {};
    for (const p of purchases) byType[p.type] = (byType[p.type] ?? 0) + 1;
    await writePatternTrace({
      universo: {
        ...universe,
        compras_no_filtro: purchases.length,
        fora_do_filtro: rows.length - purchases.length,
        compras_por_tipo: byType,
        compras_analisadas: result.compras_analisadas,
        hora: { cobertura: result.cobertura_hora, contas: extras.accountsTime },
        datas_de_salario: extras.salaryDates,
        renda_media_cents: income?.avgIn ?? null,
        limites: LIMITS,
        limite_de_destaques: filtered ? MAX_HIGHLIGHTS_FILTERED : MAX_HIGHLIGHTS,
      },
      candidatos: trace.candidates,
      selecao: selectionTrace(result.destaques, deduped, highlights, refs),
      sobreposicoes: overlaps(trace.candidates),
      resposta: out,
    });
  }
  return out;
}

/**
 * Período de cada valor de `padroes` (base = total do período; alavancas,
 * em_jogo e metades = por mês), para o checkMoney pegar "R$ 2.100,00 por mês"
 * quando R$ 2.100,00 é o total de 6 meses. `elsewhere` é o resto do dinheiro
 * apurado: valor que também aparece lá fica neutro.
 */
export function patternPeriods(results: readonly { chamada: { name: string }; resultado: unknown }[], elsewhere: string) {
  const periods = new Map<string, Set<Period>>();
  const add = (formatted: unknown, period: Period) => {
    if (typeof formatted !== "string") return;
    for (const v of moneyIn(formatted)) (periods.get(v) ?? periods.set(v, new Set()).get(v)!).add(period);
  };
  for (const r of results) {
    if (r.chamada.name !== "padroes") continue;
    const list = (r.resultado as { destaques?: Record<string, unknown>[] } | null)?.destaques ?? [];
    for (const h of list) {
      const base = (h.base ?? {}) as Record<string, unknown>;
      add(base.corte_formatted, "periodo");
      add(base.recorte_formatted, "periodo");
      add(h.em_jogo_formatted, "mes");
      for (const l of (h.alavancas ?? []) as Record<string, unknown>[]) add(l.formatted, "mes");
      const halves = (h.metades ?? {}) as Record<string, unknown>;
      add(halves.anterior_formatted, "mes");
      add(halves.recente_formatted, "mes");
    }
  }
  for (const v of moneyIn(elsewhere)) periods.get(v)?.add("neutro");
  return periods;
}
