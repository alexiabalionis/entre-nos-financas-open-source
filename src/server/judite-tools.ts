// Ferramentas da Judite (SPEC-JUDITE-COMO-SOBRAR-MAIS e SPEC-JUDITE-COPILOTO):
// o modelo pede uma ferramenta, o servidor calcula com código determinístico e
// devolve o resultado compacto, com o dinheiro já formatado. A Judite nunca
// calcula: só explica o que as ferramentas devolveram. Nenhuma ferramenta grava.
import { withFormattedMoney } from "../domain/retrieval.ts";
import { normalizeSearch, normalizeTopics } from "../domain/memory-search.ts";
import type { MovementSource } from "../domain/movements.ts";
import { settledToday } from "./bank-settled.ts";
import { readState } from "./state.ts";
import { readCategoryEveryday, type CategoryEveryday } from "./context-notes.ts";
import { simulateScenario } from "./future-simulate.ts";
import { categoryHistoryTool, notesTool, sobraTool } from "./judite-tools-sobra.ts";
import {
  categoryDetailTool,
  compareMonthsTool,
  period,
  searchMovementsTool,
  topSpendTool,
} from "./judite-tools-movements.ts";
import { billsDueTool, cardsTool, currentMonthTool, fixedBillsTool, reservesTool } from "./judite-tools-month.ts";
import { incomeTool } from "./judite-tools-income.ts";
import { warningsTool } from "./judite-tools-warnings.ts";
import { openingTool } from "./judite-tools-opening.ts";
import { horizonTool } from "./judite-tools-horizon.ts";
import { searchMemoryTool } from "./judite-tools-memory.ts";
import { loadSpend, patternsTool, type SpendData } from "./judite-tools-patterns.ts";
import { investigateTool } from "./judite-tools-investigate.ts";
import { changeTool } from "./judite-tools-change.ts";
import { readFuture } from "./future-plan.ts";
import type { FutureInput, FutureResult } from "../domain/future-months.ts";
import type { MemoryRef, ToolCall, ToolDeps } from "./judite-tools-schema.ts";
import type { PatternRef } from "../domain/pattern-check.ts";

export type ToolContext = Omit<ToolDeps, "everyday" | "memoryRefs" | "patternRefs" | "recipientRefs" | "monthState" | "spend" | "futurePlan"> & {
  /** Carregado uma vez por pergunta e reaproveitado entre ferramentas. */
  cache: ToolCache;
};

/** Cache de UMA pergunta: some com ela. Nenhuma ferramenta grava, então nada
 *  no laço invalida estes resultados; uma escrita no meio exige invalidate(). */
export type ToolCache = {
  everyday?: Promise<CategoryEveryday>;
  memoryRefs?: Map<string, MemoryRef>;
  patternRefs?: Map<string, PatternRef>;
  states?: Map<string, Promise<MovementSource>>;
  results?: Map<string, Promise<unknown>>;
  spend?: Map<number, Promise<SpendData>>;
  /** Destinatário de Pix → d0, d1...: estável na pergunta toda. */
  recipientRefs?: Map<string, string>;
  future?: Promise<{ input: FutureInput; result: FutureResult }>;
};
export function invalidateToolCache(cache: ToolCache) {
  delete cache.everyday;
  delete cache.future;
  cache.spend?.clear();
  cache.states?.clear();
  cache.results?.clear();
}

async function dispatch(deps: ToolDeps, call: ToolCall): Promise<unknown> {
  switch (call.name) {
    case "sobra_atual":
    case "caminhos_para_sobrar":
    case "acima_do_normal":
      return sobraTool(deps, call);
    case "renda_por_tipo":
      return incomeTool(deps);
    case "avisos_de_dados":
      return warningsTool(deps, call);
    case "abertura":
      return openingTool(deps);
    case "proximas_decisoes":
      return horizonTool(deps);
    case "historico_categoria":
      return categoryHistoryTool(deps, call.categoria, call.comparar_com);
    case "notas":
      return notesTool(deps);
    case "buscar_movimentos":
      return searchMovementsTool(deps, call);
    case "maiores_gastos":
      return topSpendTool(deps, call);
    case "detalhar_categoria":
      return categoryDetailTool(deps, call);
    case "comparar_meses":
      return compareMonthsTool(deps, call);
    case "padroes":
      return patternsTool(deps, call);
    case "investigar_gastos":
      return investigateTool(deps, call);
    case "simular_mudanca":
      return changeTool(deps, call);
    case "mes_atual":
      return currentMonthTool(deps);
    case "falta_pagar":
      return billsDueTool(deps);
    case "contas_fixas":
      return fixedBillsTool(deps, call.mes);
    case "cartoes":
      return cardsTool(deps, call.mes);
    case "reservas":
      return reservesTool(deps);
    case "search_memory":
      return searchMemoryTool(deps, call);
    case "simular":
      return {
        resultado: await simulateScenario(deps.db, deps.user, deps.catalog.goals ?? [], call.cenario, deps.future),
      };
  }
}

function deps(ctx: ToolContext): ToolDeps {
  const { cache, ...rest } = ctx;
  const d: ToolDeps = {
    ...rest,
    everyday: () => (cache.everyday ??= readCategoryEveryday(ctx.db, ctx.user)),
    memoryRefs: (cache.memoryRefs ??= new Map()),
    patternRefs: (cache.patternRefs ??= new Map()),
    recipientRefs: (cache.recipientRefs ??= new Map()),
    monthState: (month) => {
      const states = (cache.states ??= new Map());
      let s = states.get(month);
      if (!s) {
        s = readState(ctx.db, ctx.user, `${month}-01`, ctx.currency, undefined, undefined, false);
        states.set(month, s);
      }
      return s;
    },
    spend: (n) => {
      const all = (cache.spend ??= new Map());
      let s = all.get(n);
      if (!s) {
        s = loadSpend(d, n, d.recipientRefs);
        all.set(n, s);
        s.catch(() => all.delete(n));
      }
      return s;
    },
    futurePlan: () => (ctx.future ? Promise.resolve(ctx.future) : (cache.future ??= readFuture(ctx.db, ctx.user, {}))),
  };
  return d;
}

/**
 * Chave canônica de uma chamada já validada: ferramenta + argumentos
 * resolvidos (refs viram ids, padrões aplicados, texto normalizado) + escopo
 * (casa, moeda, dia). Duas formas de pedir a mesma coisa dão a mesma chave.
 */
export function toolKey(ctx: ToolContext, call: ToolCall): string {
  const d = deps(ctx);
  const id = (list: { id?: string; name?: string }[] | undefined, ref: string) =>
    list?.[Number(ref.slice(1))]?.id ?? list?.[Number(ref.slice(1))]?.name ?? `?${ref}`;
  const args: Record<string, unknown> = { ...call };
  if ("categoria" in call && typeof call.categoria === "string") args.categoria = id(d.catalog.categories, call.categoria);
  if ("conta" in call && call.conta) args.conta = id(d.catalog.accounts, call.conta);
  if ("comparar_com" in call && call.comparar_com) args.comparar_com = d.memoryRefs.get(call.comparar_com)?.id ?? `?${call.comparar_com}`;
  if (call.name === "buscar_movimentos" || call.name === "maiores_gastos" || call.name === "detalhar_categoria") {
    try {
      const p = period(call);
      args.de = p.de;
      args.ate = p.ate;
    } catch {
      // período inválido: a ferramenta recusa; a chave fica com o que veio.
    }
  }
  if (call.name === "buscar_movimentos") args.limite = call.limite ?? 50;
  if (call.name === "padroes" || call.name === "investigar_gastos" || call.name === "avisos_de_dados") args.meses = call.meses ?? 6;
  if (call.name === "investigar_gastos" || call.name === "simular_mudanca") {
    if (call.padrao) args.padrao = d.patternRefs.get(call.padrao)?.ids?.join(",") ?? `?${call.padrao}`;
    if (call.lugar) args.lugar = normalizeSearch(call.lugar);
  }
  if (call.name === "investigar_gastos") {
    args.operacoes = [...call.operacoes].sort();
    args.limite = call.limite ?? 20;
    if (call.depois_categoria) {
      args.depois_categoria = id(d.catalog.categories, call.depois_categoria);
      args.dias = call.dias ?? 4;
    }
  }
  if (call.name === "buscar_movimentos" && call.texto) args.texto = normalizeSearch(call.texto);
  if (call.name === "maiores_gastos") {
    args.n = call.n ?? 10;
    args.agrupar = call.agrupar ?? "lancamento";
  }
  if (call.name === "contas_fixas" || call.name === "cartoes") args.mes = call.mes ?? settledToday().slice(0, 7);
  if (call.name === "search_memory") {
    args.limite = call.limite ?? 10;
    if (call.consulta) args.consulta = normalizeSearch(call.consulta);
    if (call.temas) args.temas = [...normalizeTopics(call.temas)].sort();
  }
  const sorted = Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([ctx.user.familyId, ctx.currency, settledToday(), sorted]);
}

/**
 * Executa uma ferramenta e devolve o resultado com o dinheiro formatado.
 * Chamada repetida na mesma pergunta devolve o resultado guardado.
 */
export async function runTool(ctx: ToolContext, call: ToolCall): Promise<unknown> {
  return (await runToolCached(ctx, call)).result;
}

export async function runToolCached(ctx: ToolContext, call: ToolCall): Promise<{ result: unknown; repeated: boolean }> {
  const results = (ctx.cache.results ??= new Map());
  const key = toolKey(ctx, call);
  const hit = results.get(key);
  if (hit) return { result: await hit, repeated: true };
  const run = (async () => {
    const out = await dispatch(deps(ctx), call);
    // Texto de memória é dado histórico: não ganha *_formatted (não vira fonte).
    return call.name === "search_memory" ? out : withFormattedMoney(out, ctx.currency);
  })();
  results.set(key, run);
  try {
    return { result: await run, repeated: false };
  } catch (error) {
    // Erro não fica em cache: outra tentativa pode ter argumentos corrigidos.
    results.delete(key);
    throw error;
  }
}
