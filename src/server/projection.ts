import { asUser, type Database } from "./db.ts";
import type { Transaction } from "@electric-sql/pglite";
import type { Identity } from "./auth.ts";
import { dateOnly } from "../domain/finance.ts";
import { addDays } from "../domain/day.ts";
import { resolveCategory } from "./assisted.ts";
import { reconcile } from "../domain/projection-reconcile.ts";
import type { Quality, ReconciledFlow } from "../domain/projection-reconcile.ts";
import {
  assessConfidence,
  type ConfidenceState,
  type Gap,
  type GapFlow,
} from "../domain/projection-confidence.ts";
import { defaultMargin } from "../domain/everyday.ts";
import {
  readUsualBreakdown,
  readUsualWeekly,
} from "./projection-reads-everyday.ts";
import type { DayPoint } from "../domain/projection.ts";
import {
  STATUS_WORD,
  deficitWithin,
  lowWithin,
  monthBounds,
  monthMode,
  sliceToMonth,
  startCentsAt,
} from "../domain/projection-month.ts";
import { loadCardCompetence } from "./card-competence.ts";
import { nextMonth } from "./projection-reads.ts";
import {
  readCashSnapshot,
  readFinanceSettings,
  stalenessFrom,
} from "./projection-reads-cash.ts";
import { readBills } from "./projection-reads-bills.ts";
import { readReserve } from "./projection-reads-reserve.ts";
import {
  reconcileReserve,
  reserveCushion,
} from "../domain/projection-reserve.ts";
import {
  readItems,
  readReceipts,
  readScheduled,
} from "./projection-reads-plan.ts";

// F1a do Copiloto: coletor do Raio-X do futuro. Lê o banco da família, monta as
// entradas do motor puro (reconcile + project/assessConfidence) e devolve o
// retrato do caixa no horizonte. F2 expõe `shown` (o número que PODE ir pra
// tela — só nos estados com folga calculável; null nos demais); `cCons` cru
// continua de fora do retorno. Só leitura; nada aqui registra lançamento.

export type ProjectionReport = {
  today: string;
  horizonEnd: string;
  sConf: bigint;
  snapshotDate: string | null;
  /** Saldo por conta que compõe sConf (mesma leitura, mesma soma). */
  accounts: { id: string; name: string; cents: bigint; date: string | null }[];
  state: ConfidenceState;
  // Número que PODE ir pra tela ("quanto dá pra gastar"): só preenchido nos
  // estados com folga calculável (COM_RESSALVA/CONFIRMADO); null nos demais
  // (INDETERMINADO/SEM_FOLGA/DEPENDE_DE_DADOS), caso em que a tela mostra a
  // palavra do estado em vez de um número. Vem de assessConfidence.shown.
  shown: bigint | null;
  // Data do próximo salário/recebimento: o MENOR recebimento previsto futuro
  // (>today) ainda não detectado. null quando não há nenhum.
  nextIncomeDate: string | null;
  gaps: Gap[];
  needed: Gap[];
  flows: ReconciledFlow[];
  // Nomes legíveis (label) e categorias de cada fluxo, resolvidos pelo coletor
  // por lookup da key contra as leituras do banco. Vive fora de ReconciledFlow
  // (tipo puro do domínio, que não ganha label/category) e é consumido só na
  // conversão para o fio (flowToWire).
  names: FlowNames;
  series: DayPoint[];
  low: {
    nom: { day: string; cents: bigint };
    cons: { day: string; cents: bigint };
  };
  deficit: { cents: bigint; day: string } | null;
  // Colchão efetivo que o motor descontou (margem + reserva guardada na
  // própria conta). Exposto para quem precisa da mesma margem sem recalcular.
  cushion: bigint;
  // Só no modo Copiloto: ritmo de sempre (referência), margem escolhida ou
  // padrão, e a reserva guardada na própria conta. null na aba Mês.
  copilot: {
    usualWeekly: bigint | null;
    margin: bigint;
    marginChosen: boolean;
    reserveOnAccount: bigint;
  } | null;
};

// Tipo de FIO (wire): mesmo retrato acima, mas com todo valor monetário em
// string de centavos. json() (src/server/http.ts) já serializa bigint como
// string via replacer, mas o TYPE de ProjectionReport continuava bigint — uma
// mentira de tipo (quem consome via fetch recebe string onde o tipo promete
// bigint). Convenção igual à do resto do server (ex: readState devolve
// balance_cents: string, nunca bigint, na borda HTTP). toProjectionWire() é o
// único ponto de conversão; a rota chama ele antes de json(). readProjection()
// continua devolvendo ProjectionReport (bigint) — é o tipo de domínio, testado
// diretamente por tests-js/projection-collector.test.ts com asserts em bigint.
export type ProjectionFlowWire = {
  key: string;
  direction: "in" | "out";
  nom: { date: string; cents: string };
  cons: { date: string; cents: string };
  initiated?: boolean;
  quality: Quality;
  sources: string[];
  explain: string;
  // Nome legível do fluxo para a tela (/preview-mes não resolve sozinha). Nunca
  // vazio: cai no explain quando a key não tem nome conhecido. Resolvido no
  // coletor por lookup da key contra mapas montados das leituras do banco.
  label: string;
  // Nome da categoria do fluxo, ou null quando não se aplica (fatura de cartão,
  // recebimento previsto). Exigido só para direction 'out'.
  category: string | null;
};

// Resolve label/category de um fluxo pela sua key, contra os mapas montados no
// coletor a partir das leituras do banco. label nunca vazio (fallback explain).
export type FlowNames = {
  // Nome legível por key de fluxo (item/bill/sched/inc/cardplan).
  labelByKey: Map<string, string>;
  // Nome da categoria por key de fluxo; só keys com categoria conhecida.
  categoryByKey: Map<string, string>;
};

export type ProjectionGapWire = {
  key: string;
  quality: string;
  impact: string | "unbounded";
  reason: string;
};

export type ProjectionPointWire = { day: string; nom: string; cons: string };

export type ProjectionWire = {
  today: string;
  horizonEnd: string;
  sConf: string;
  snapshotDate: string | null;
  accounts: { id: string; name: string; cents: string; date: string | null }[];
  state: ConfidenceState;
  shown: string | null;
  nextIncomeDate: string | null;
  gaps: ProjectionGapWire[];
  needed: ProjectionGapWire[];
  flows: ProjectionFlowWire[];
  series: ProjectionPointWire[];
  low: {
    nom: { day: string; cents: string };
    cons: { day: string; cents: string };
  };
  deficit: { cents: string; day: string } | null;
};

function flowToWire(f: ReconciledFlow, names: FlowNames): ProjectionFlowWire {
  // label: nome resolvido pela key; fallback no explain para nunca ficar vazio.
  const label = names.labelByKey.get(f.key) || f.explain;
  // category: nome da categoria por key, ou null quando não se aplica.
  const category = names.categoryByKey.get(f.key) ?? null;
  const wire: ProjectionFlowWire = {
    key: f.key,
    direction: f.direction,
    nom: { date: f.nom.date, cents: f.nom.cents.toString() },
    cons: { date: f.cons.date, cents: f.cons.cents.toString() },
    quality: f.quality,
    sources: f.sources,
    explain: f.explain,
    label,
    category,
  };
  if (f.initiated) wire.initiated = true;
  return wire;
}

function gapToWire(g: Gap): ProjectionGapWire {
  return {
    key: g.key,
    quality: g.quality,
    impact: g.impact === "unbounded" ? "unbounded" : g.impact.toString(),
    reason: g.reason,
  };
}

function pointToWire(p: DayPoint): ProjectionPointWire {
  return { day: p.day, nom: p.nom.toString(), cons: p.cons.toString() };
}

// Converte o retrato do motor (bigint, domínio) para o tipo de fio (string de
// centavos) que de fato atravessa json() — corrige a mentira de tipo do H1 do
// review F1a: ProjectionReport prometia bigint, o cliente recebia string.
export function toProjectionWire(report: ProjectionReport): ProjectionWire {
  return {
    today: report.today,
    horizonEnd: report.horizonEnd,
    sConf: report.sConf.toString(),
    snapshotDate: report.snapshotDate,
    accounts: report.accounts.map((a) => ({ ...a, cents: a.cents.toString() })),
    state: report.state,
    shown: report.shown === null ? null : report.shown.toString(),
    nextIncomeDate: report.nextIncomeDate,
    gaps: report.gaps.map(gapToWire),
    needed: report.needed.map(gapToWire),
    flows: report.flows.map((f) => flowToWire(f, report.names)),
    series: report.series.map(pointToWire),
    low: {
      nom: { day: report.low.nom.day, cents: report.low.nom.cents.toString() },
      cons: {
        day: report.low.cons.day,
        cents: report.low.cons.cents.toString(),
      },
    },
    deficit: report.deficit
      ? { cents: report.deficit.cents.toString(), day: report.deficit.day }
      : null,
  };
}

const HORIZON_CAP_DAYS = 62;
const HORIZON_FALLBACK_DAYS = 31;

// horizonEnd = véspera do PRIMEIRO recebimento futuro (o "próximo salário"),
// limitado a today+62. Sem recebimento futuro, today+31. Nunca antes de today.
// A aba Mês ("Seu mês até o salário") e o Copiloto usam o mesmo horizonte.
function horizonFrom(today: string, receiptDates: string[]): string {
  const future = [...new Set(receiptDates.filter((d) => d > today))].sort();
  const cap = addDays(today, HORIZON_CAP_DAYS);
  let end: string;
  if (future.length > 0) end = addDays(future[0], -1);
  else end = addDays(today, HORIZON_FALLBACK_DAYS);
  if (end > cap) end = cap;
  if (end < today) end = today;
  return end;
}

// Mantém só os pontos da série em que o saldo nom ou cons muda em relação ao
// dia anterior (o primeiro e o último dia sempre entram). Reduz a série ao
// essencial para a tela sem perder nenhuma inflexão, e o gráfico sempre vai
// até o fim do horizonte, mesmo quando nada muda no caminho.
function compressSeries(series: DayPoint[]): DayPoint[] {
  const out: DayPoint[] = [];
  for (let i = 0; i < series.length; i++) {
    const point = series[i];
    const prev = series[i - 1];
    if (!prev || i === series.length - 1 || point.nom !== prev.nom || point.cons !== prev.cons)
      out.push(point);
  }
  return out;
}

// Resolve o nome legível (label) e a categoria de cada fluxo por LOOKUP da key
// contra as leituras do banco. A tela /preview-mes não resolve esses nomes
// sozinha, então o coletor os monta aqui (consultas dedicadas id->nome, por
// família via RLS do tx). label nunca vai vazio — flowToWire cai no explain
// quando não há nome conhecido.
//
//  - item:<id> / item:<id>:paid -> label = monthly_items.label;
//    category = nome da categoria do item (category_id -> categories.name).
//  - bill:<card>:<dueMonth> / bill:...:sched:<payId> -> label = 'Fatura ' +
//    nome do cartão (accounts.name); category = null.
//  - sched:<id> -> label = description do lançamento; category = a MESMA
//    categoria sugerida/confirmada que a aba Movimentos mostra
//    (resolveCategory(merchant_rules, description), DRY).
//  - inc:<id> -> label = nome da série de renda (recurrences.label); renda é
//    direction 'in', category null (categoria só interessa a 'out').
//  - cardplan:<month> -> label fixo legível; category null.
async function resolveFlowNames(
  tx: Transaction,
  familyId: string,
  flows: ReconciledFlow[],
  months: string[],
  extra?: FlowNames,
): Promise<FlowNames> {
  // rec:<scope>:<lojista>:<mês> -> nomes já resolvidos pelo coletor de
  // recorrências (a key não carrega o id de um lookup simples).
  const labelByKey = new Map<string, string>(extra?.labelByKey);
  const categoryByKey = new Map<string, string>(extra?.categoryByKey);

  // Itens do plano: label + nome da categoria (join em categories).
  const itemRows = (
    await tx.query<{ id: string; label: string; category_name: string | null }>(
      `SELECT m.id,m.label,c.name AS category_name
       FROM monthly_items m LEFT JOIN categories c ON c.id=m.category_id
       WHERE m.household_id=$1 AND NOT m.archived AND m.currency='BRL'
         AND to_char(m.month,'YYYY-MM')=ANY($2)`,
      [familyId, months],
    )
  ).rows;
  const itemLabel = new Map<string, string>();
  const itemCategory = new Map<string, string | null>();
  for (const r of itemRows) {
    itemLabel.set(r.id, r.label);
    itemCategory.set(r.id, r.category_name);
  }

  // Cartões: nome da conta (kind=card) para rotular a fatura.
  const cardRows = (
    await tx.query<{ id: string; name: string }>(
      "SELECT id,name FROM accounts WHERE household_id=$1 AND kind='card'",
      [familyId],
    )
  ).rows;
  const cardName = new Map(cardRows.map((r) => [r.id, r.name]));

  // Agendamentos de saída (bank_transactions): description + categoria
  // sugerida/confirmada pela mesma fonte da aba Movimentos (resolveCategory).
  const schedRows = (
    await tx.query<{ id: string; description: string }>(
      `SELECT t.id,t.description
       FROM bank_transactions t JOIN accounts a ON a.id=t.local_account_id
       WHERE t.household_id=$1 AND a.kind<>'card'
         AND t.status='pending' AND t.event_id IS NULL
         AND NOT t.changed AND NOT t.missing
         AND t.provider_status='PENDING' AND t.amount_cents<0`,
      [familyId],
    )
  ).rows;
  const merchantRules = (
    await tx.query<{ match_text: string; category_name: string }>(
      "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
      [familyId],
    )
  ).rows;
  const schedLabel = new Map<string, string>();
  const schedCategory = new Map<string, string>();
  for (const r of schedRows) {
    schedLabel.set(r.id, r.description);
    schedCategory.set(r.id, resolveCategory(merchantRules, r.description).name);
  }

  // Regras de renda: nome da regra para os recebimentos previstos (inc:).
  const incRows = (
    await tx.query<{ id: string; label: string }>(
      `SELECT o.id,r.label
       FROM recurrence_occurrences o JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
       WHERE o.household_id=$1 AND r.purpose='income'`,
      [familyId],
    )
  ).rows;
  const incLabel = new Map(incRows.map((r) => [r.id, r.label]));

  for (const f of flows) {
    const { key } = f;
    if (key.startsWith("item:")) {
      // item:<id> ou item:<id>:paid -> o id é o segmento do meio.
      const id = key.split(":")[1];
      const label = itemLabel.get(id);
      if (label) labelByKey.set(key, label);
      const cat = itemCategory.get(id);
      if (cat) categoryByKey.set(key, cat);
    } else if (key.startsWith("bill:")) {
      // bill:<card>:<dueMonth>[:sched:<payId>] -> card é o 2º segmento.
      const card = key.split(":")[1];
      const name = cardName.get(card);
      if (name) labelByKey.set(key, `Fatura ${name}`);
      // category = null (fatura de cartão): não entra em categoryByKey.
    } else if (key.startsWith("sched:")) {
      const id = key.slice("sched:".length);
      const label = schedLabel.get(id);
      if (label) labelByKey.set(key, label);
      const cat = schedCategory.get(id);
      if (cat) categoryByKey.set(key, cat);
    } else if (key.startsWith("inc:")) {
      const id = key.slice("inc:".length);
      const label = incLabel.get(id);
      if (label) labelByKey.set(key, label);
      // renda é direction 'in': category null.
    } else if (key.startsWith("cardplan:")) {
      labelByKey.set(key, "Compras de cartão previstas");
      // category = null.
    }
  }

  return { labelByKey, categoryByKey };
}

// "Hoje" em America/Sao_Paulo (mesmo SQL para o motor e para o modo do mês).
export async function readToday(tx: Transaction): Promise<string> {
  return (
    await tx.query<{ today: string }>(
      "SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS today",
    )
  ).rows[0].today;
}

// `copilot` liga o que só o Copiloto usa: gasto do dia a dia estimado e a
// reserva. A aba Mês (default) mantém o cálculo pelos itens reais, sem essas
// estimativas, para não mudar os números que ela já mostrava.
type ProjectionOpts = { today?: string; horizonEnd?: string; copilot?: boolean };

export async function readProjection(
  db: Database,
  user: Identity,
  opts: ProjectionOpts = {},
): Promise<ProjectionReport> {
  return (await readProjectionRaw(db, user, opts)).report;
}

// Mesmo retrato de readProjection + a série DIÁRIA completa (antes de
// comprimir) e o colchão, que o recorte por mês precisa.
type RawProjection = {
  report: ProjectionReport;
  rawSeries: DayPoint[];
  cushion: bigint;
};

async function readProjectionRaw(
  db: Database,
  user: Identity,
  opts: ProjectionOpts = {},
): Promise<RawProjection> {
  const copilot = opts.copilot === true;
  return asUser(db, user.userId, async (tx) => {
    const today = opts.today ?? (await readToday(tx));
    dateOnly(today);

    const settings = await readFinanceSettings(tx, user.familyId);
    const { noIncomeDeclared } = settings;

    const hasIncomeRule =
      (
        await tx.query(
          "SELECT 1 FROM recurrences WHERE household_id=$1 AND purpose='income' AND NOT paused LIMIT 1",
          [user.familyId],
        )
      ).rows.length > 0;

    const snapshot = await readCashSnapshot(tx, user.familyId);
    const competence = await loadCardCompetence(tx, user.familyId);

    const monthKey = today.slice(0, 7);
    const months = [monthKey, nextMonth(monthKey)];

    const reserve = copilot
      ? await readReserve(tx, { familyId: user.familyId, months })
      : null;

    const [items, bills, scheduled, receipts] = await Promise.all([
      readItems(tx, user.familyId, months),
      readBills(tx, user.familyId, competence, months),
      readScheduled(tx, user.familyId, snapshot.snapshotDate, today),
      readReceipts(tx, user.familyId, today),
    ]);

    const horizonEnd = opts.horizonEnd
      ? dateOnly(opts.horizonEnd < today ? today : opts.horizonEnd)
      : horizonFrom(
          today,
          receipts.filter((r) => !r.detected).map((r) => r.expected),
        );

    // Copiloto: a base é a mesma da aba Mês (saldo menos contas previstas). O
    // gasto do dia a dia NÃO é descontado: o ritmo de sempre só serve de
    // referência e para a margem padrão (meia semana típica). Colchão =
    // margem escolhida + reserva guardada na própria conta.
    const usualWeekly = copilot
      ? await readUsualWeekly(tx, {
          familyId: user.familyId,
          today,
          declaredWeekly: settings.everydayWeekly,
        })
      : null;
    const margin = copilot
      ? (settings.copilotMargin ?? defaultMargin(usualWeekly))
      : 0n;
    const reserveOnAccount = reserve ? reserveCushion(reserve) : 0n;
    const cushion = copilot ? margin + reserveOnAccount : settings.cushion;

    const reconciled = reconcile({
      today,
      snapshotDate: snapshot.snapshotDate ?? today,
      items,
      bills,
      scheduled,
      receipts,
      strictToday: copilot,
    });
    const reserveFlows = reserve
      ? reconcileReserve(
          { today, snapshotDate: snapshot.snapshotDate ?? today },
          reserve,
        )
      : [];
    const flows = [...reconciled, ...reserveFlows];

    // Defasagem do saldo (staleness): dias desde o snapshot e a taxa diária de
    // gasto estimada pela média recente. Sem snapshot (nenhuma conta com data
    // de leitura) não há defasagem a projetar.
    const staleness = await stalenessFrom(
      tx,
      user.familyId,
      snapshot.snapshotDate,
      today,
    );

    const gapFlows: GapFlow[] = flows.map((f) => ({ ...f }));
    const assessment = assessConfidence({
      today,
      horizonEnd,
      cushion,
      sConf: snapshot.sConf,
      flows: gapFlows,
      unbounded: snapshot.unbounded,
      hasIncomeRule,
      noIncomeDeclared,
      staleness: staleness ?? undefined,
    });

    // Data do próximo salário: o MENOR recebimento previsto futuro (>today)
    // ainda não detectado (ordenado asc). null quando não há nenhum — a tela
    // então omite o "(DD/MM)" do rótulo.
    const nextIncomeDate =
      receipts
        .filter((r) => !r.detected && r.expected > today)
        .map((r) => r.expected)
        .sort()[0] ?? null;

    // Nomes legíveis e categorias de cada fluxo (lookup da key contra o banco),
    // para a tela não ter de resolvê-los sozinha.
    const names = await resolveFlowNames(
      tx,
      user.familyId,
      flows,
      months,
      {
        labelByKey: new Map(reserve?.names.labelByKey ?? []),
        categoryByKey: new Map(reserve?.names.categoryByKey ?? []),
      },
    );

    // Fluxos ordenados por data (nom), depois por key para desempate estável.
    const byDate = [...flows].sort((a, b) =>
      a.nom.date === b.nom.date
        ? a.key < b.key
          ? -1
          : a.key > b.key
            ? 1
            : 0
        : a.nom.date < b.nom.date
          ? -1
          : 1,
    );

    return {
      report: {
        today,
        horizonEnd,
        sConf: snapshot.sConf,
        snapshotDate: snapshot.snapshotDate,
        accounts: snapshot.accounts,
        state: assessment.state,
        shown: assessment.shown,
        nextIncomeDate,
        gaps: assessment.gaps,
        needed: assessment.needed,
        flows: byDate,
        names,
        series: compressSeries(assessment.result.series),
        low: assessment.result.low,
        deficit: assessment.result.deficit,
        cushion,
        copilot: copilot
          ? {
              usualWeekly,
              margin,
              marginChosen: settings.copilotMargin !== null,
              reserveOnAccount,
            }
          : null,
      },
      rawSeries: assessment.result.series,
      cushion,
    };
  });
}

// Projeção do MÊS pedido (YYYY-MM; ausente = mês atual). Modos: current (igual
// ao readProjection), future (mês seguinte: estimativa recortada ao mês, sem
// `shown`), closed/unavailable (sem rodar o motor).
export type ProjectionMonthWire =
  | (ProjectionWire & {
      mode: "current" | "future";
      statusWord: string;
      monthStart: string;
      monthEnd: string;
      startCents: string | null;
    })
  | {
      mode: "closed" | "unavailable";
      statusWord: string;
      monthStart: string;
      monthEnd: string;
    };

export async function readProjectionMonth(
  db: Database,
  user: Identity,
  month?: string,
  opts: { today?: string } = {},
): Promise<ProjectionMonthWire> {
  const today =
    opts.today ??
    (await asUser(db, user.userId, (tx) => readToday(tx)));
  dateOnly(today);
  const target = month ?? today.slice(0, 7);
  const mode = monthMode(today, target);
  const bounds = monthBounds(target);
  const edges = { monthStart: bounds.start, monthEnd: bounds.end };

  if (mode === "closed" || mode === "unavailable")
    return { mode, statusWord: STATUS_WORD[mode], ...edges };

  if (mode === "current") {
    const report = await readProjection(db, user, { today });
    // Caminho do saldo vai até o fim do mês, mesmo quando o horizonte (véspera
    // do pagamento) acaba antes; o resto do retrato segue o horizonte.
    const path =
      report.horizonEnd < bounds.end
        ? (await readProjection(db, user, { today, horizonEnd: bounds.end })).series
        : report.series;
    return {
      ...toProjectionWire(report),
      series: path.map(pointToWire),
      mode,
      statusWord: STATUS_WORD[report.state],
      ...edges,
      // Hoje é o início da série; saldo conservador de hoje.
      startCents: startCentsAt(report.series, today)?.toString() ?? null,
    };
  }

  // future: horizonte vai até o fim do mês pedido; estado e lacunas valem para
  // o intervalo INTEIRO (hoje até monthEnd). Corte do mês ANTES de comprimir.
  const { report, rawSeries, cushion } = await readProjectionRaw(db, user, {
    today,
    horizonEnd: bounds.end,
  });
  const low = lowWithin(rawSeries, bounds);
  if (!low) throw new Error("Mês sem dias na projeção.");
  const inMonth = (f: ReconciledFlow): boolean =>
    f.cons.date >= bounds.start && f.cons.date <= bounds.end;
  return {
    ...toProjectionWire({
      ...report,
      shown: null,
      flows: report.flows.filter(inMonth),
      series: compressSeries(sliceToMonth(rawSeries, bounds)),
      low,
      deficit: deficitWithin(rawSeries, bounds, cushion),
    }),
    mode,
    statusWord: STATUS_WORD.future,
    ...edges,
    startCents: startCentsAt(rawSeries, bounds.start)?.toString() ?? null,
  };
}

// Raio-x do "dia a dia de sempre" do Copiloto (só leitura): mesmas exclusões
// do readProjection({ copilot: true }), para conferir de onde vem o número.
export async function readUsualAudit(
  db: Database,
  user: Identity,
  opts: { today?: string } = {},
) {
  return asUser(db, user.userId, async (tx) => {
    const today = opts.today ?? (await readToday(tx));
    const settings = await readFinanceSettings(tx, user.familyId);
    return readUsualBreakdown(tx, {
      familyId: user.familyId,
      today,
      declaredWeekly: settings.everydayWeekly,
    });
  });
}
