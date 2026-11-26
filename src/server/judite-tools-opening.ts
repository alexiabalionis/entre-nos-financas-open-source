// Ferramenta abertura (SPEC-JUDITE-PROFUNDIDADE, Fase 2b): o que tem dentro das
// categorias que mais pesam. Lê pela mesma leitura de detalhar_categoria
// (readExpensePurchases, população "movimentos"): os meses fechados vêm de
// deps.spend(6) e o mês atual até hoje é lido à parte, com a mesma regra.
// Rótulo: apelido da casa; Pix sem apelido fica "Pix enviado (dN)", nunca o nome.
import { openingReading, UNCATEGORIZED, type OpeningBuy } from "../domain/opening.ts";
import { promptLabel, type Movement } from "../domain/movements.ts";
import { placeOf } from "../domain/spend-patterns-core.ts";
import { settledToday } from "./bank-settled.ts";
import { readExpensePurchases } from "./judite-tools-movements.ts";
import { readExtras, recipientRef, toPurchase, type Extras } from "./judite-tools-patterns.ts";
import type { ToolDeps } from "./judite-tools-schema.ts";

const WINDOW_MONTHS = 6;

function buyOf(
  r: Movement,
  extras: Pick<Extras, "meta" | "essentialNames">,
  kinds: ReadonlyMap<string, string>,
  refs: Map<string, string>,
): OpeningBuy {
  const purchase = toPurchase(r, extras, kinds);
  const label = promptLabel(r);
  const nick = r.displayName?.trim() || r.aliasName?.trim();
  const who = recipientRef(r, refs);
  return {
    date: r.date,
    category: r.category ?? UNCATEGORIZED,
    cents: purchase.cents,
    rotulo: !nick && who ? `${label} (${who})` : label,
    place: !nick && who ? `pix:${who}` : placeOf(label),
    fixedLike: purchase.type === "fixa" || purchase.type === "parcela",
  };
}

export async function openingTool(deps: ToolDeps): Promise<unknown> {
  const today = settledToday();
  const current = today.slice(0, 7);
  const data = await deps.spend(WINDOW_MONTHS);
  const closed = data.months;
  const range = { de: `${(closed.slice(-3)[0] ?? current)}-01`, ate: today };
  if (!closed.length) return { periodo: range, categorias: [] };

  const now = { de: `${current}-01`, ate: today, months: [current] };
  const rows = await readExpensePurchases(deps, now);
  const extras = await readExtras(deps, rows, now.de, now.ate);
  const buys = [
    ...data.rows.map((r) => buyOf(r, data.extras, data.kinds, deps.recipientRefs)),
    ...rows.map((r) => buyOf(r, extras, data.kinds, deps.recipientRefs)),
  ];
  return {
    periodo: range,
    categorias: openingReading({ buys, closed, current }).map((c) => ({
      categoria: c.categoria,
      total_periodo_cents: c.total_periodo.toString(),
      media_3_fechados_cents: c.media_3_fechados.toString(),
      media_6_fechados_cents: c.media_6_fechados.toString(),
      maiores_compras: c.maiores_compras.map((b) => ({ dia: b.dia, rotulo: b.rotulo, cents: b.cents.toString() })),
      lugares_que_se_repetem: c.lugares_que_se_repetem.map((l) => ({ rotulo: l.rotulo, vezes: l.vezes, total_cents: l.total.toString() })),
    })),
  };
}
