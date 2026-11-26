import { project, type Flow, type ProjectionResult } from "./projection.ts";
import type { Quality } from "./projection-reconcile.ts";

// F0d do Copiloto: classifica a CONFIABILIDADE da projeção de caixa pelo
// IMPACTO de cada lacuna no resultado — não por um score arbitrário. Uma
// "lacuna" é um fluxo cuja qualidade ainda não é firme (estimado, inconsistente
// ou saldo defasado). O impacto de uma lacuna é quanto a capacidade conservadora
// (cCons) subiria se aquele fluxo fosse tão bom quanto o seu valor nominal: é o
// peso real daquela incerteza sobre a decisão. Função PURA: sem I/O, sem banco,
// não muta o input e é determinística. Reusa project() de projection.ts para não
// duplicar o cálculo da série.

// Fluxo que chega ao Copiloto já conciliado; "stale" é a defasagem do saldo lido
// há N dias (não é uma Quality de conciliação, é sinal de dado vencido).
export type GapFlow = Flow & { quality: Quality | "stale" };

export type ConfidenceInput = {
  today: string;
  horizonEnd: string;
  cushion: bigint;
  sConf: bigint;
  flows: readonly GapFlow[];
  // Lacunas sem valor possível de estimar (ex.: fatura em revisão, sem total e
  // sem histórico). Não têm impacto numérico: tornam a projeção indeterminada.
  unbounded: { key: string; reason: string }[];
  // Há regra de recebimento declarada? Se não há regra E o usuário também não
  // declarou "não tenho renda", a projeção fica indeterminada (income em aberto).
  hasIncomeRule: boolean;
  noIncomeDeclared: boolean;
  // Saldo foi lido há `days` dias; `dailyRate` é a estimativa de gasto diário
  // não observado (calculada pelo chamador). Vira um fluxo de defasagem em today.
  staleness?: { days: number; dailyRate: bigint };
};

export type Gap = {
  key: string;
  quality: string;
  impact: bigint | "unbounded";
  reason: string;
};

export type ConfidenceState =
  | "CONFIRMADO"
  | "COM_RESSALVA"
  | "DEPENDE_DE_DADOS"
  | "SEM_FOLGA"
  | "INDETERMINADO";

export type ConfidenceResult = {
  result: ProjectionResult;
  state: ConfidenceState;
  shown: bigint | null;
  gaps: Gap[];
  needed: Gap[];
};

// Qualidades firmes não geram lacuna; só estas carregam incerteza relevante.
const GAP_QUALITIES = new Set<GapFlow["quality"]>([
  "estimated",
  "inconsistent",
  "stale",
]);

const STALE_KEY = "stale:saldo";
const NO_INCOME_KEY = "income:sem-regra";

// Converte GapFlow -> Flow (o motor project ignora o campo quality).
function toFlow(flow: GapFlow): Flow {
  const base: Flow = {
    key: flow.key,
    direction: flow.direction,
    nom: { date: flow.nom.date, cents: flow.nom.cents },
    cons: { date: flow.cons.date, cents: flow.cons.cents },
  };
  if (flow.initiated) base.initiated = true;
  return base;
}

// Regra 1: a defasagem do saldo vira um fluxo de saída em today. nom 0 (no
// melhor caso nada saiu sem a gente ver), cons = days * dailyRate (no pior caso
// gastou-se à taxa estimada durante os dias não observados), quality 'stale'.
function stalenessFlow(
  staleness: NonNullable<ConfidenceInput["staleness"]>,
  today: string,
): GapFlow {
  return {
    key: STALE_KEY,
    direction: "out",
    nom: { date: today, cents: 0n },
    cons: { date: today, cents: BigInt(staleness.days) * staleness.dailyRate },
    quality: "stale",
  };
}

function compareGaps(a: Gap, b: Gap): number {
  if (a.impact !== b.impact) {
    if (a.impact === "unbounded") return -1;
    if (b.impact === "unbounded") return 1;
    return a.impact > b.impact ? -1 : 1;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}


export function assessConfidence(input: ConfidenceInput): ConfidenceResult {
  // Fonte de fluxos: os informados + o fluxo de defasagem quando o saldo está
  // vencido (days > 0). Não muta o input.
  const gapFlows: GapFlow[] = [...input.flows];
  if (input.staleness && input.staleness.days > 0)
    gapFlows.push(stalenessFlow(input.staleness, input.today));

  const baseFlows = gapFlows.map(toFlow);
  const result = project({
    today: input.today,
    horizonEnd: input.horizonEnd,
    cushion: input.cushion,
    sConf: input.sConf,
    flows: baseFlows,
  });

  // Impacto de cada lacuna: cCons da projeção com o cons daquele fluxo trocado
  // pelo nom (data e valor) menos o cCons base. Sempre >= 0 porque trocar um
  // cons incerto pelo nominal nunca piora a capacidade conservadora.
  const base = { ...input, staleness: undefined };
  const gaps: Gap[] = [];
  for (const flow of gapFlows) {
    if (!GAP_QUALITIES.has(flow.quality)) continue;
    const swapped = baseFlows.map((candidate) =>
      candidate.key === flow.key
        ? {
            ...candidate,
            cons: { date: flow.nom.date, cents: flow.nom.cents },
          }
        : candidate,
    );
    const withNom = project({
      today: base.today,
      horizonEnd: base.horizonEnd,
      cushion: base.cushion,
      sConf: base.sConf,
      flows: swapped,
    });
    const impact = withNom.cCons - result.cCons;
    gaps.push({
      key: flow.key,
      quality: flow.quality,
      impact: impact < 0n ? 0n : impact,
      reason: "",
    });
  }

  // Lacunas sem valor possível: impacto 'unbounded'. Deduplicadas pela key.
  for (const item of input.unbounded)
    gaps.push({
      key: item.key,
      quality: "unbounded",
      impact: "unbounded",
      reason: item.reason,
    });

  // Sem regra de recebimento e sem "não tenho renda" declarado: income em
  // aberto também é uma lacuna sem valor possível.
  if (!input.hasIncomeRule && !input.noIncomeDeclared)
    gaps.push({
      key: NO_INCOME_KEY,
      quality: "unbounded",
      impact: "unbounded",
      reason: "Sem regra de recebimento e sem declaração de ausência de renda.",
    });

  // Ordenação determinística: impacto desc, depois key asc. 'unbounded' vem
  // antes de qualquer impacto numérico (incerteza sem teto pesa mais).
  gaps.sort(compareGaps);

  const hasUnbounded = gaps.some((gap) => gap.impact === "unbounded");
  const hasPositiveGap = gaps.some(
    (gap) => gap.impact !== "unbounded" && gap.impact > 0n,
  );

  // Estado — primeira regra que valer manda. Nada é limitado a zero antes do
  // cálculo; cNom/cCons vêm direto da projeção.
  let state: ConfidenceState;
  let shown: bigint | null;
  const needed: Gap[] = [];

  if (hasUnbounded) {
    // Há lacuna sem valor possível: não dá para afirmar capacidade.
    state = "INDETERMINADO";
    shown = null;
  } else if (result.cNom <= 0n) {
    // Nem no melhor caso sobra folga: não é questão de dado, é de dinheiro.
    state = "SEM_FOLGA";
    shown = null;
  } else if (result.cCons <= 0n) {
    // No melhor caso sobra, no pior não: a folga DEPENDE de resolver lacunas.
    // needed = menor prefixo (por impacto desc) cuja soma de impactos passa de
    // -cCons, ou seja, o conjunto mínimo de lacunas que, resolvidas, levariam a
    // capacidade conservadora de volta ao positivo.
    state = "DEPENDE_DE_DADOS";
    shown = null;
    const target = -result.cCons;
    let acc = 0n;
    for (const gap of gaps) {
      if (acc > target) break;
      if (gap.impact === "unbounded") continue;
      if (gap.impact === 0n) continue;
      needed.push(gap);
      acc += gap.impact;
    }
  } else if (hasPositiveGap) {
    // Há folga conservadora, mas alguma lacuna ainda pesa sobre ela.
    state = "COM_RESSALVA";
    shown = result.cCons;
  } else {
    // Folga conservadora firme, nenhuma lacuna com peso.
    state = "CONFIRMADO";
    shown = result.cCons;
  }

  return { result, state, shown, gaps, needed };
}
