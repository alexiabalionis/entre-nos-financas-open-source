// Renda por tipo (SPEC-JUDITE-LACUNAS, Fase 1): separa o que se repete do que
// é avulso e marca o que parece dinheiro da própria casa. Puro, sem I/O, e sem
// regra nova de dinheiro: só rotula as linhas que o Panorama já soma.
import { normalizeSearch } from "./memory-search.ts";
import { median } from "./median.ts";

export const INCOME_GROUPS = ["recorrente", "avulsa", "rendimento", "suspeita_dinheiro_proprio"] as const;
export type IncomeGroup = (typeof INCOME_GROUPS)[number];
export type SuspectReason = "investimento" | "conta_da_casa" | "nome_da_casa";

export type IncomeRow = { id: string; month: string; cents: bigint; kind: string; description: string };
export type ClassifiedIncome = IncomeRow & {
  group: IncomeGroup;
  /** Descrição sem Pix/TED e sem números; nunca sai do servidor. */
  origin: string;
  reason: SuspectReason | null;
};

const MIN_MONTHS = 3;
// ±20% da mediana, em centésimos para ficar em bigint.
const TOLERANCE = 20n;

/** Origem: a mesma ideia de recipientKey de judite-tools-patterns.ts, mais "recebid*" e "de". */
export function incomeOrigin(description: string): string {
  return normalizeSearch(description)
    .replace(/\b(pix|ted|doc|transf\w*|recebid\w*|enviad\w*|de|cpf|cnpj)\b/g, " ")
    .replace(/[\d.*/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const INVESTMENT = /\b(resgat|rdb|cdb|aplicac|poupanc|investiment|mesma titularidade)/;
const LABELS: [RegExp, string][] = [
  [/\bresgat/, "Resgate"],
  [/\baplicac/, "Aplicação"],
  [/\brdb/, "RDB"],
  [/\bcdb/, "CDB"],
  [/\bpoupanc/, "Poupança"],
  [/\binvestiment/, "Investimento"],
];

/** Rótulo de investimento montado só de palavras conhecidas: nunca carrega nome de pessoa. */
export function investmentLabel(description: string): string {
  const d = normalizeSearch(description);
  return LABELS.filter(([re]) => re.test(d)).map(([, l]) => l).join(" ") || "Investimento";
}

const named = (d: string, names: readonly string[]) =>
  names.map(normalizeSearch).some((n) => n.length >= 3 && d.includes(n));

function suspectReason(description: string, accountNames: readonly string[], memberNames: readonly string[]): SuspectReason | null {
  const d = normalizeSearch(description);
  if (INVESTMENT.test(d)) return "investimento";
  if (named(d, accountNames)) return "conta_da_casa";
  if (named(d, memberNames)) return "nome_da_casa";
  return null;
}

/**
 * Entradas que se repetem: da mesma origem, as de valor parecido (±20% da mediana da origem)
 * em ≥ 3 meses da janela. Uma entrada diferente da mesma origem (um bônus, um acerto) fica
 * avulsa sozinha, sem derrubar as outras (antes derrubava a origem inteira).
 */
function repeatingEntries(rows: readonly (IncomeRow & { origin: string })[]): Set<string> {
  const byOrigin = new Map<string, (IncomeRow & { origin: string })[]>();
  for (const r of rows) if (r.origin) byOrigin.set(r.origin, [...(byOrigin.get(r.origin) ?? []), r]);
  const out = new Set<string>();
  for (const list of byOrigin.values()) {
    if (new Set(list.map((r) => r.month)).size < MIN_MONTHS) continue;
    const mid = median(list.map((r) => r.cents));
    const gap = (c: bigint) => (c > mid ? c - mid : mid - c);
    const similar = list.filter((r) => gap(r.cents) * 100n <= mid * TOLERANCE);
    if (new Set(similar.map((r) => r.month)).size >= MIN_MONTHS) for (const r of similar) out.add(r.id);
  }
  return out;
}

/** Primeira regra que casar: suspeita, rendimento, recorrente (ou ligada a regra de renda), avulsa. */
export function classifyIncome(p: {
  entries: readonly IncomeRow[];
  accountNames: readonly string[];
  memberNames: readonly string[];
  linkedIds: ReadonlySet<string>;
}): ClassifiedIncome[] {
  const rows = p.entries.map((e) => ({ ...e, origin: incomeOrigin(e.description) }));
  const repeating = repeatingEntries(rows.filter((r) => r.kind !== "yield" && !suspectReason(r.description, p.accountNames, p.memberNames)));
  return rows.map((r) => {
    const reason = suspectReason(r.description, p.accountNames, p.memberNames);
    const group: IncomeGroup = reason
      ? "suspeita_dinheiro_proprio"
      : r.kind === "yield"
        ? "rendimento"
        : p.linkedIds.has(r.id) || repeating.has(r.id)
          ? "recorrente"
          : "avulsa";
    return { ...r, group, reason };
  });
}

/** Sobra só com a renda que se repete: média mensal recorrente menos a saída média. */
export function structuralSobra(p: { rows: readonly ClassifiedIncome[]; months: number; avgOut: bigint }) {
  const total = p.rows.filter((r) => r.group === "recorrente").reduce((s, r) => s + r.cents, 0n);
  const avgRecurring = p.months > 0 ? total / BigInt(p.months) : 0n;
  const kept = avgRecurring - p.avgOut;
  return { kept, pct: avgRecurring > 0n ? Number((kept * 1000n) / avgRecurring) / 10 : null };
}

// Mês com saída acima de 1,5 vez a mediana é "fora da curva": aparece pelo nome, não some da média.
const OUTLIER_FACTOR_X10 = 15n;

/**
 * O mês típico pela mediana (um mês fora da curva não arrasta o número), ao lado da média,
 * que continua sendo a conta real do período. Mesmos meses fechados da média.
 */
export function typicalMonth(months: readonly { month: string; in: bigint; out: bigint }[]) {
  if (!months.length) return null;
  const inMedian = median(months.map((m) => m.in));
  const outMedian = median(months.map((m) => m.out));
  return {
    entradaMediana: inMedian,
    saidaMediana: outMedian,
    sobraMediana: inMedian - outMedian,
    foraDaCurva: months.filter((m) => m.out * 10n > outMedian * OUTLIER_FACTOR_X10).map((m) => ({ month: m.month, out: m.out })),
  };
}
