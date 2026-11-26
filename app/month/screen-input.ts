// Helpers PUROS que preparam a entrada da tela Mês a partir das respostas de
// família/month e família/projection. Extraídos de app/preview-mes/page.tsx
// (Etapa 4): a mesma lógica agora serve preview-mes e family.tsx, sem
// duplicar. Sem React — testável por node --test (ver
// tests-js/month-screen-input.test.ts).
import type { Currency } from "../../src/domain/finance.ts";
import type { ProjectionMonthWire } from "../../src/server/projection.ts";
import { monthMode } from "../../src/domain/projection-month.ts";
import { wireToView, type ProjectionMode, type ProjectionView } from "../projection-view.ts";
import type { Category } from "./model.ts";

/** Soma o saldo (balance_cents) das contas na moeda pedida, em centavos. null
 *  quando nenhuma conta tem saldo conhecido nessa moeda — nunca fabrica 0. */
export function balanceCentsFor(
  accounts: readonly { currency: Currency; balance_cents: string | null }[],
  currency: Currency,
): string | null {
  const withBalance = accounts.filter(
    (acc) => acc.currency === currency && acc.balance_cents != null,
  );
  if (withBalance.length === 0) return null;
  return withBalance
    .reduce((sum, acc) => sum + BigInt(acc.balance_cents!), 0n)
    .toString();
}

export type ProjectionScreen = {
  view: ProjectionView | null;
  mode: ProjectionMode | undefined;
  statusWord: string | undefined;
};

// Junta projectionReady + wireToView + o fallback local de monthMode: a MESMA
// decisão que preview-mes/page.tsx fazia inline. `loading` é a busca do mês
// pedido ainda em voo (evita tratar "ainda não chegou" como "sem projeção");
// `today` é a data corrente (YYYY-MM-DD, BRT) de quem chama.
export function projectionScreen(
  projection: ProjectionMonthWire | null,
  month: string,
  loading: boolean,
  today: string,
): ProjectionScreen {
  // Só confia na projeção quando é do mês pedido (evita mostrar a velha
  // durante o fetch de outro mês).
  const projectionReady =
    !!projection && projection.monthStart === month + "-01";
  const view = wireToView(projection, month);
  // Sem projeção e sem busca em andamento: deriva o modo localmente (mesmo
  // cálculo do servidor) para um mês 2+ à frente mostrar o aviso certo.
  const localMode =
    projection === null && !loading ? monthMode(today, month) : undefined;
  return {
    view,
    mode: projectionReady ? projection.mode : localMode,
    statusWord: projectionReady ? projection.statusWord : undefined,
  };
}

/** Categorias no formato que buildMonthModel espera (id/name/colorIndex). */
export function monthCategories(
  categories: readonly { id: string; name: string; color_index: number | null }[],
): Category[] {
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    colorIndex: c.color_index,
  }));
}
