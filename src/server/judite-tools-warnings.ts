// Ferramenta avisos_de_dados (SPEC-JUDITE-LACUNAS, Fase 2): aponta o que pode
// distorcer a análise (sem categoria, compra fora da curva, linhas em revisão,
// entrada suspeita) antes de a Judite sugerir corte. Mesma janela e mesma
// leitura de padroes; nada é gravado nem tirado de nenhum total.
import { outliers, uncategorized } from "../domain/data-warnings.ts";
import { asUser } from "./db.ts";
import { incomeTool } from "./judite-tools-income.ts";
import type { ToolCall, ToolDeps } from "./judite-tools-schema.ts";

const DEFAULT_MONTHS = 6;
const str = (v: bigint) => v.toString();
const pct = (part: bigint, total: bigint) => (total > 0n ? Number((part * 1000n) / total) / 10 : 0);

type Call = Extract<ToolCall, { name: "avisos_de_dados" }>;

/** Linhas do banco que ainda esperam decisão e por isso não entram nos totais. */
async function readReview(deps: ToolDeps, de: string, ate: string) {
  const rows = await asUser(deps.db, deps.user.userId, (tx) =>
    tx.query<{ cents: string }>(
      `SELECT t.amount_cents::text AS cents
         FROM bank_transactions t JOIN accounts a ON a.id=t.local_account_id
        WHERE t.household_id=$1 AND a.kind<>'card'
          AND t.status='pending' AND t.event_id IS NULL AND NOT t.missing
          AND coalesce(t.analysis->>'group','') IN ('', 'unclear', 'pending')
          AND t.transaction_date BETWEEN $2::date AND $3::date`,
      [deps.user.familyId, de, ate],
    ),
  );
  let out = 0n;
  let inn = 0n;
  for (const r of rows.rows) {
    const v = BigInt(r.cents);
    if (v < 0n) out -= v;
    else inn += v;
  }
  return { linhas: rows.rows.length, saidas_cents: str(out), entradas_cents: str(inn) };
}

/** Reaproveita a classificação da Fase 1: só lê o grupo suspeito do resultado. */
async function suspectIncome(deps: ToolDeps) {
  const income = (await incomeTool(deps)) as { por_grupo?: { grupo: string; total_cents: string; entradas: number }[] };
  const g = income.por_grupo?.find((x) => x.grupo === "suspeita_dinheiro_proprio");
  return { entradas: g?.entradas ?? 0, total_cents: g?.total_cents ?? "0" };
}

export async function warningsTool(deps: ToolDeps, call: Call): Promise<unknown> {
  const data = await deps.spend(call.meses ?? DEFAULT_MONTHS);
  const { purchases, recipients, window } = data;
  const total = purchases.reduce((s, p) => (p.cents > 0n ? s + p.cents : s), 0n);
  const none = uncategorized(purchases, recipients);
  return {
    periodo: { de: window.de, ate: window.ate },
    saida_total_cents: str(total),
    sem_categoria: {
      compras: none.count,
      total_cents: str(none.cents),
      parte_da_saida: pct(none.cents, total),
      grupos: none.groups.map((g) => ({ destinatario: g.recipient, lugar: g.place, compras: g.count, total_cents: str(g.cents) })),
    },
    fora_da_curva: outliers(purchases, recipients).map((o) => ({
      categoria: o.category,
      mes: o.month,
      valor_cents: str(o.cents),
      rotulo: o.label,
      parte_do_mes_da_categoria: o.sharePct,
      mes_da_categoria_cents: str(o.categoryMonthCents),
      mes_sem_ela_cents: str(o.withoutItCents),
      normal_cents: str(o.normalCents),
    })),
    em_revisao: await readReview(deps, window.de, window.ate),
    entradas_suspeitas: await suspectIncome(deps),
  };
}
