// Ferramenta renda_por_tipo (SPEC-JUDITE-LACUNAS, Fase 1): separa a entrada dos
// meses fechados em recorrente, avulsa, rendimento e suspeita de dinheiro
// próprio. Só rotula as linhas que o Panorama soma; nada sai da sobra atual.
import {
  classifyIncome,
  INCOME_GROUPS,
  investmentLabel,
  structuralSobra,
  typicalMonth,
  type ClassifiedIncome,
} from "../domain/income-types.ts";
import { sobraPaths } from "../domain/sobra-paths.ts";
import { asUser } from "./db.ts";
import { readIncomeEntries } from "./insights.ts";
import type { ToolDeps } from "./judite-tools-schema.ts";

const str = (v: bigint) => v.toString();
const AVISO = "Suspeitas continuam somadas na sobra atual; confirme com a pessoa antes de tirar.";

async function readIncome(deps: ToolDeps, from: string, to: string) {
  const familyId = deps.user.familyId;
  // family_app não lê members/users; o runtime (como auth.ts) lê, sempre filtrado pela casa da sessão.
  // Fora da transação: o PGlite tem uma conexão só.
  const members = await deps.db.query<{ name: string }>(
    "SELECT u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.household_id=$1",
    [familyId],
  );
  return asUser(deps.db, deps.user.userId, async (tx) => {
    const entries = await readIncomeEntries(tx, { familyId, from, to });
    // Entrada ligada a uma regra de renda: a ocorrência casou com a linha do banco ou com o evento dela.
    const linked = await tx.query<{ bank_id: string; event_id: string | null }>(
      `SELECT o.match_bank_transaction_id::text AS bank_id, bt.event_id::text AS event_id
         FROM recurrence_occurrences o
         JOIN recurrences r ON r.household_id=o.household_id AND r.id=o.recurrence_id
         JOIN bank_transactions bt ON bt.household_id=o.household_id AND bt.id=o.match_bank_transaction_id
        WHERE o.household_id=$1 AND r.purpose='income' AND NOT r.paused`,
      [familyId],
    );
    return {
      entries,
      memberNames: members.rows.map((m) => m.name),
      linkedIds: new Set(linked.rows.flatMap((l) => (l.event_id ? [l.bank_id, l.event_id] : [l.bank_id]))),
    };
  });
}

export async function incomeTool(deps: ToolDeps): Promise<unknown> {
  const e = await deps.everyday();
  const closed = e.months.filter((m) => m.month < e.currentMonth && (m.in > 0n || m.out > 0n));
  // Mesma média de sobra_atual: o mesmo filtro de meses fechados e a mesma função.
  const paths = sobraPaths({
    months: e.months,
    categories: e.categories,
    protectedNames: new Set(e.protectedNames),
    currentMonth: e.currentMonth,
    target: { cents: 0n },
  });
  if (!paths) return { sem_historico: true, motivo: "Ainda não há mês fechado com movimento." };
  const months = new Set(closed.map((m) => m.month));
  const first = closed.map((m) => m.month).sort()[0]!;
  const data = await readIncome(deps, `${first}-01`, `${e.currentMonth}-01`);
  const rows = data.entries
    .filter((x) => months.has(x.date.slice(0, 7)))
    .map((x) => ({ id: x.id, month: x.date.slice(0, 7), cents: x.cents, kind: x.kind, description: x.description }));
  const classified = classifyIncome({
    entries: rows,
    accountNames: deps.catalog.accounts.map((a) => a.name),
    memberNames: data.memberNames,
    linkedIds: data.linkedIds,
  });

  // Origem opaca (o0, o1...): a descrição nunca sai. Rótulo de investimento é a exceção.
  const refs = new Map<string, string>();
  const opaque = (r: ClassifiedIncome) => {
    if (r.reason === "investimento") return investmentLabel(r.description);
    const key = r.origin || r.id;
    if (!refs.has(key)) refs.set(key, `o${refs.size}`);
    return refs.get(key)!;
  };
  const top = (list: ClassifiedIncome[], n: number) =>
    [...list].sort((a, b) => (a.cents > b.cents ? -1 : a.cents < b.cents ? 1 : 0)).slice(0, n);
  const structural = structuralSobra({ rows: classified, months: paths.months, avgOut: paths.avgOut });
  const typical = typicalMonth(closed);
  // Sobra estrutural do mês típico: a renda que se repete contra a saída mediana.
  const typicalKept = typical ? structural.kept + paths.avgOut - typical.saidaMediana : null;
  const n = BigInt(paths.months);
  return {
    meses_fechados: paths.months,
    periodo: { de: first, ate: closed.map((m) => m.month).sort().at(-1) },
    por_grupo: INCOME_GROUPS.map((grupo) => {
      const list = classified.filter((r) => r.group === grupo);
      const total = list.reduce((s, r) => s + r.cents, 0n);
      return { grupo, media_mensal_cents: str(total / n), total_cents: str(total), entradas: list.length };
    }),
    saida_media_cents: str(paths.avgOut),
    sobra_atual_media_cents: str(paths.kept),
    sobra_estrutural_cents: str(structural.kept),
    sobra_estrutural_pct: structural.pct,
    // Positivo, para dizer "faltam R$ X por mês" sem sinal duplicado ("negativa em R$ -X").
    ...(structural.kept < 0n ? { deficit_estrutural_cents: str(-structural.kept) } : {}),
    ...(typical && typicalKept !== null
      ? {
          mes_tipico: {
            explicacao: "Mediana dos meses fechados: um mês fora da curva não arrasta o número. A média (acima) é a conta real do período, com esses meses.",
            entrada_mediana_cents: str(typical.entradaMediana),
            saida_mediana_cents: str(typical.saidaMediana),
            sobra_mediana_cents: str(typical.sobraMediana),
            sobra_estrutural_cents: str(typicalKept),
            ...(typicalKept < 0n ? { deficit_estrutural_cents: str(-typicalKept) } : {}),
            meses_fora_da_curva: typical.foraDaCurva.map((m) => ({ mes: m.month, saiu_cents: str(m.out) })),
          },
        }
      : {}),
    suspeitas: top(classified.filter((r) => r.group === "suspeita_dinheiro_proprio"), 10).map((r) => ({
      mes: r.month,
      cents: str(r.cents),
      origem: opaque(r),
      motivo: r.reason,
    })),
    avulsas_maiores: top(classified.filter((r) => r.group === "avulsa"), 5).map((r) => ({
      mes: r.month,
      cents: str(r.cents),
      origem: opaque(r),
    })),
    aviso: AVISO,
  };
}
