// Laço da Judite (Fase 7.5): protocolo de saída, orçamento global, evidência
// mínima garantida, deduplicação, reparo financeiro e medição. Nada aqui grava.
import {
  checkMoney,
  dropUnverified,
  formattedMoneyText,
  repairFallback,
  OMITTED_NOTE,
  moneyIn,
  type MemorySource,
  type MoneyRole,
  type MoneySources,
} from "../domain/money-check.ts";
import { checkPatterns, type PatternRef } from "../domain/pattern-check.ts";
import { patternPeriods } from "./judite-tools-patterns.ts";
import { requestLlm, requestLlmChat, slowModel, thinkingModel, type ChatMessage, type LlmMeter } from "./llm.ts";
import { UserError } from "./imports.ts";
import { runToolCached, type ToolContext } from "./judite-tools.ts";
import { MAX_TOOL_CALLS, type ToolCall } from "./judite-tools-schema.ts";
import { classifyReply, MAX_PROTOCOL_RETRIES, PROTOCOL_FAILURE } from "./judite-protocol.ts";
import { budgetFreePrefetch, followUp, initialPrefetch, openDiagnosticIntent } from "./judite-evidence.ts";
import { NATIVE_NOTE, nativeTools, parseNativeCall, promptCompact, protocolShape, type RouteOptions, type ToolMode } from "./judite-tools-native.ts";
import { checkHypotheses, type Hypothesis, type RefIndex } from "../domain/hypothesis-check.ts";
import { finalizationContext } from "./judite-finalize.ts";
import { classicFormat, numbersRewrite } from "./judite-numbers.ts";

const TIME_BUDGET_MS = 40_000;
/** Teto de idas ao modelo por pergunta, somando tudo (ferramentas, erros, reparo). */
const MAX_ROUNDS = MAX_TOOL_CALLS + MAX_PROTOCOL_RETRIES + 4;
export const NO_VERIFIED_ANSWER =
  "Não consegui responder com números conferidos. Tente perguntar de outro jeito, por exemplo citando o mês ou a categoria.";

export type ToolResult = {
  chamada: (ToolCall | { name: string; invalida: true }) & Record<string, unknown>;
  resultado: unknown;
};
export type Trace = {
  solicitadas: number;
  executadas: number;
  repetidas: number;
  invalidas: number;
  prefetch: number;
  protocolo: number;
  reparos: number;
  removidos: number;
  /** Valores da resposta que só existem na pergunta atual (fala da pessoa). */
  declarados: number;
  /** O que a 1ª versão da resposta afirmou sem origem (valores, períodos, padrões). */
  sem_origem: string[];
  /** Respostas finais devolvidas por anunciar uma busca em vez de pedir a ferramenta. */
  anuncios: number;
  /** As hipóteses do diagnóstico aceitas e o que a conferência apontou na 1ª versão. */
  hipoteses: Hypothesis[] | null;
  hipoteses_problemas: string[];
  /** Por que cada resposta fora do protocolo foi recusada: erro e a forma da resposta, com os valores mascarados (sem dado da casa). */
  protocolo_erros: { erro: string; tipo: string; caracteres: number; forma: string }[];
  /** Chamadas de ferramenta recebidas pelo Function Calling nativo. */
  nativas: number;
  /** Frases de padrão aceitas sem etiqueta (algum resultado da pergunta sustenta). */
  padroes_sem_etiqueta: number;
  /** Frases de padrão sem base que ficaram no texto (a reescrita não resolveu): medidas, nunca apagadas. */
  padroes_mantidos: string[];
  /** Teto de ferramentas desta pergunta, contando o prefetch (MAX_TOOL_CALLS, salvo o experimento da rota aberta). */
  limite: number;
  /** Caracteres do contexto de finalização enviado (0 = não enviado). */
  finalizacao: number;
  /** Idas extras puladas por falta de tempo no orçamento ("hipoteses", "numeros", "reparo"). */
  sem_tempo: string[];
  /** Valores e percentuais do text acima do limite que ficaram (reescrita sem efeito ou sem tempo); null = dentro do limite. */
  numeros_no_texto: number | null;
  /** Reescritas pedidas por excesso de números no text (no máximo 1). */
  reescrita_numeros: number;
  /** Instante (Date.now) em que acaba o orçamento de tempo da pergunta. */
  prazo: number;
  meter: LlmMeter;
};

// Resposta final que promete uma busca ("vou analisar os padrões") em vez de pedir a ferramenta.
const ANNOUNCES = /\b(vou|irei|vamos|preciso|deixa eu) (buscar|analisar|investigar|olhar|verificar|consultar|checar|levantar|cruzar|aprofundar)\b/i;

/** Refs desta pergunta para conferir as hipóteses (pN e iN de padroes/investigar_gastos; sN com o tipo da simulação). */
export function refIndexOf(ctx: ToolContext): RefIndex {
  const all = ctx.cache.patternRefs ?? new Map();
  const patterns = new Set([...all.keys()].filter((k) => !k.startsWith("s")));
  const simulations = new Map([...all].filter(([k]) => k.startsWith("s")).map(([k, v]) => [k, v.corte] as const));
  return { patterns, simulations };
}

type Payload = { model: string; instructions: string; input: string; json?: boolean; max_output_tokens?: number };

export async function runChatLoop(p: {
  payload: Payload;
  ctx: ToolContext;
  question: string;
  activeMemories: number;
  meter: LlmMeter;
  /** "native" = Function Calling do provedor; "json" (padrão) = o protocolo {"tool":...} de sempre. */
  mode?: ToolMode;
  /** Teto de ferramentas contando o prefetch; padrão MAX_TOOL_CALLS. */
  maxTools?: number;
  /** Mandar o contexto de finalização antes da 1ª resposta final (rota aberta). */
  finalContext?: boolean;
  /** Otimizações da rota (routeOptions); sem o campo, só as variáveis de ambiente. */
  options?: Pick<RouteOptions, "compact" | "keepTools" | "finalShort">;
  /** Diagnóstico pela pergunta ou pela conversa (diagnosticIntent); sem o campo, só a pergunta. */
  diagnostic?: boolean;
  /** Rota aberta: recebe a leitura de abertura no prefetch, fora do orçamento. */
  openRoute?: boolean;
}): Promise<{ final: { text: string; action: unknown; contas?: string; hipoteses?: Hypothesis[] } | null; results: ToolResult[]; trace: Trace }> {
  const started = Date.now();
  const results: ToolResult[] = [];
  const limit = p.maxTools ?? MAX_TOOL_CALLS;
  const trace: Trace = { solicitadas: 0, executadas: 0, repetidas: 0, invalidas: 0, prefetch: 0, protocolo: 0, reparos: 0, removidos: 0, declarados: 0, sem_origem: [], anuncios: 0, hipoteses: null, hipoteses_problemas: [], protocolo_erros: [], nativas: 0, padroes_sem_etiqueta: 0, padroes_mantidos: [], limite: limit, finalizacao: 0, sem_tempo: [], numeros_no_texto: null, reescrita_numeros: 0, prazo: 0, meter: p.meter };
  let used = 0;
  // Modelo que pensa (":thinking") leva bem mais por ida; o teto de idas continua o mesmo.
  const budget = thinkingModel(p.payload.model) || slowModel(p.payload.model) ? 150_000 : TIME_BUDGET_MS;
  trace.prazo = started + budget;
  // Toda ida extra (hipóteses, números, reparo) só sai antes do prazo; depois dele, o caminho de sempre.
  const timeLeft = () => Date.now() < trace.prazo;
  const native = p.mode === "native";
  // Modo nativo: a conversa (chamadas e resultados pelo id do provedor) e quantos resultados o modelo já viu.
  const convo: ChatMessage[] = [];
  const seen = new Set<ToolResult>();
  const keepTools = native && (p.options?.keepTools ?? process.env.JUDITE_FINAL_KEEP_TOOLS === "1");
  const compact = p.options?.compact ?? promptCompact();
  let calledAtZero = false;
  const left = () => (timeLeft() ? Math.max(0, limit - used) : 0);

  const run = async (call: ToolCall, prefetch: boolean, free = false) => {
    if (prefetch) trace.prefetch++;
    else trace.solicitadas++;
    try {
      const { result, repeated } = await runToolCached(p.ctx, call);
      if (repeated) {
        trace.repetidas++;
        // Não executa de novo nem gasta orçamento de ferramentas; não repete o
        // conteúdo. Repetir sem avançar conta como erro de protocolo.
        results.push({ chamada: call, resultado: { repetida: true, aviso: "Mesmo pedido de antes: use o resultado anterior." } });
        if (!prefetch) {
          trace.protocolo++;
          stalled = trace.protocolo > MAX_PROTOCOL_RETRIES;
        }
        return;
      }
      // Prefetch do diagnóstico fora do orçamento: o modelo segue com as próprias chamadas.
      if (!free) {
        trace.executadas++;
        used++;
      }
      results.push({ chamada: call, resultado: result });
    } catch (error) {
      if (!free) used++;
      results.push({ chamada: call, resultado: { erro: error instanceof UserError ? error.message : "Ferramenta indisponível agora." } });
    }
    // A evidência que a pergunta exige, assim que dá para saber qual é (uma vez).
    if (followed) return;
    const next = followUp({ question: p.question, results, categories: p.ctx.catalog.categories });
    if (next && left() > 0) {
      followed = true;
      await run(next, true);
    }
  };
  let followed = false;
  let stalled = false;

  // Prefetch conta no orçamento de ferramentas, salvo o extra do diagnóstico.
  for (const call of initialPrefetch({ question: p.question, activeMemories: p.activeMemories, diagnostic: p.diagnostic, open: p.openRoute })) {
    const free = budgetFreePrefetch(call);
    if (free || left() > 0) await run(call, true, free);
  }

  let hint: string | null = null;
  let contractRetry = false;
  let announced = false;
  let hypothesisRetry = false;
  let numbersRewritten = false;
  // Contexto de finalização: só quando quem chama pede (help.ts: rota aberta), uma vez, na ida da resposta final sem ferramentas.
  let finalSent = !p.finalContext;
  const finalContext = (remaining: number) => {
    if (finalSent || remaining > 0) return {};
    finalSent = true;
    const roles = moneySources({ payloadInput: p.payload.input, question: p.question, results, memories: p.ctx.cache.memoryRefs }).roles ?? new Map();
    const contexto = finalizationContext({ results, refs: refIndexOf(p.ctx), roles, short: p.options?.finalShort });
    trace.finalizacao = JSON.stringify(contexto).length;
    return { contexto_finalizacao: contexto };
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const remaining = left();
    let text: string;
    if (native) {
      // O que o modelo ainda não viu (prefetch, evidência garantida, pedido em JSON) e o aviso vão numa mensagem só.
      const fresh = results.filter((r) => !seen.has(r));
      const aviso = hint ?? (remaining === 0 ? "Sem mais ferramentas: responda agora no formato final." : null);
      if (fresh.length || aviso || round === 0)
        convo.push({ role: "user", content: JSON.stringify({ ...(fresh.length ? { tool_results: fresh } : {}), ferramentas_restantes: remaining, ...(aviso ? { aviso } : {}), ...finalContext(remaining) }) });
      for (const r of fresh) seen.add(r);
      hint = null;
      const res = await requestLlmChat({
        ...p.payload,
        instructions: `${p.payload.instructions}\n${NATIVE_NOTE}`,
        meter: p.meter,
        tools: nativeTools(compact),
        // JUDITE_FINAL_KEEP_TOOLS=1: sem ferramentas restantes, o pedido continua igual (tool_choice auto) para o cache do
        // começo valer na resposta final; se o modelo pedir ferramenta assim mesmo, a próxima ida volta a "none".
        toolChoice: remaining > 0 || (keepTools && !calledAtZero) ? "auto" : "none",
        conversation: convo,
      });
      if (res.toolCalls.length) {
        trace.nativas += res.toolCalls.length;
        if (remaining === 0) calledAtZero = true;
        convo.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls, ...(res.reasoning ? { reasoning_content: res.reasoning } : {}), ...(res.raw ? { raw: res.raw } : {}) });
        // Toda chamada recebe resposta pelo id dela, inclusive as recusadas e as que passam do orçamento.
        for (const tc of res.toolCalls) {
          const answer = (content: unknown) => convo.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(content) });
          if (left() === 0) {
            answer({ erro: "Sem mais ferramentas nesta pergunta: responda com o que já tem." });
            continue;
          }
          const parsed = parseNativeCall(tc);
          if (!parsed.ok) {
            trace.solicitadas++;
            trace.invalidas++;
            used++;
            const invalid = { chamada: { name: parsed.name, invalida: true as const }, resultado: { erro: `argumento inválido: ${parsed.error}` } };
            results.push(invalid);
            seen.add(invalid);
            answer(invalid.resultado);
            continue;
          }
          const at = results.length;
          await run(parsed.call, false);
          const own = results[at];
          if (own) seen.add(own);
          answer(own?.resultado ?? { erro: "Ferramenta indisponível agora." });
          if (stalled) break;
        }
        // A evidência garantida (followUp) que veio junto não tem id: vai na próxima mensagem.
        if (stalled) break;
        continue;
      }
      // Resposta embrulhada em cerca de código (```json ... ```): só no modo nativo, onde não há json_object.
      text = res.content.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    } else {
      text = await requestLlm({
        ...p.payload,
        meter: p.meter,
        inputTail: JSON.stringify({
          tool_results: results,
          ferramentas_restantes: remaining,
          ...(hint ? { aviso: hint } : remaining === 0 ? { aviso: "Sem mais ferramentas: responda agora no formato final." } : {}),
          ...finalContext(remaining),
        }),
      });
      hint = null;
    }
    const reply = classifyReply(text);
    const protocolError = (message: string) => {
      trace.protocolo++;
      hint = message;
      return trace.protocolo > MAX_PROTOCOL_RETRIES;
    };
    if (reply.kind === "tool_call") {
      if (remaining === 0) {
        if (protocolError('Sem mais ferramentas: responda agora com {"text":...,"action":...}.')) break;
        continue;
      }
      await run(reply.call, false);
      if (stalled) break;
      continue;
    }
    if (reply.kind === "invalid_tool") {
      trace.solicitadas++;
      trace.invalidas++;
      if (remaining === 0) {
        if (protocolError('Sem mais ferramentas: responda agora com {"text":...,"action":...}.')) break;
        continue;
      }
      used++;
      results.push({ chamada: { name: reply.name, invalida: true }, resultado: { erro: `argumento inválido: ${reply.error}` } });
      continue;
    }
    if (reply.kind === "invalid_reply") {
      trace.protocolo_erros.push({ erro: reply.error, ...protocolShape(text) });
      if (protocolError(`Formato inválido: ${reply.error} Responda só com {"tool":{...}} ou {"text":"...","action":null}.`)) break;
      continue;
    }
    // Anunciou uma busca em vez de pedir: uma volta para pedir a ferramenta (se ainda houver).
    if (!announced && left() > 0 && ANNOUNCES.test(reply.text)) {
      announced = true;
      trace.anuncios++;
      hint = 'Você escreveu que vai buscar ou analisar algo: peça a ferramenta agora ({"tool":{...}}) ou responda sem anunciar.';
      continue;
    }
    // Diagnóstico: as hipóteses precisam bater com o que as ferramentas devolveram (uma volta de conferência).
    if (!hypothesisRetry) {
      const needs = (p.diagnostic ?? openDiagnosticIntent(p.question)) || /o que percebi/i.test(reply.text);
      const problems = reply.hipotesesErro
        ? [`hipoteses inválidas: ${reply.hipotesesErro}`]
        : reply.hipoteses
          ? checkHypotheses(reply.hipoteses, refIndexOf(p.ctx))
          : needs
            ? ['faltou o campo "hipoteses" do diagnóstico']
            : [];
      if (problems.length) {
        hypothesisRetry = true;
        trace.hipoteses_problemas = problems;
        if (!timeLeft()) trace.sem_tempo.push("hipoteses");
      }
      if (problems.length && timeLeft()) {
        hint = `Confira as hipóteses antes de responder: ${problems.join(" | ")}. Se ainda houver ferramentas, investigue o que falta; senão rebaixe o status e ajuste o texto para dizer o que não foi verificado.`;
        continue;
      }
    }
    trace.hipoteses = reply.hipoteses ?? null;
    if (hypothesisRetry && reply.hipoteses) trace.hipoteses_problemas = [...trace.hipoteses_problemas, ...checkHypotheses(reply.hipoteses, refIndexOf(p.ctx)).map((x) => `restou: ${x}`)];
    // Resposta final: só aceita se a evidência inequívoca já estiver aqui.
    const missing = followed ? null : followUp({ question: p.question, results, categories: p.ctx.catalog.categories });
    if (missing && !contractRetry && left() > 0) {
      contractRetry = true;
      followed = true;
      await run(missing, true);
      hint = "Chegou evidência nova em tool_results: revise a resposta com ela.";
      continue;
    }
    // Números demais no text (Fase 3a): uma reescrita que leva o detalhe para contas, se ainda houver tempo.
    const crowded = classicFormat() ? null : numbersRewrite(reply.text, p.diagnostic ?? openDiagnosticIntent(p.question));
    if (crowded && !numbersRewritten && timeLeft()) {
      numbersRewritten = true;
      trace.reescrita_numeros++;
      hint = crowded.hint;
      continue;
    }
    if (crowded) {
      trace.numeros_no_texto = crowded.count;
      if (!numbersRewritten) trace.sem_tempo.push("numeros");
    }
    const contas = reply.contas && !classicFormat() ? { contas: reply.contas } : {};
    return { final: { text: reply.text, action: reply.action, ...contas, ...(reply.hipoteses ? { hipoteses: reply.hipoteses } : {}) }, results, trace };
  }
  return { final: null, results, trace };
}

/**
 * De onde o dinheiro da resposta pode vir (apêndice B + Fase 7.5):
 *  - apurado: só campos *_formatted dos fatos, do catálogo e das ferramentas de
 *    números, mais a narração da simulação (texto calculado pelo app);
 *  - declarado: a pergunta atual;
 *  - memória: só pela marca {{mN:...}}.
 * Fica de fora: o histórico (vem do cliente, inclusive as respostas antigas da
 * Judite), as notas da casa, o texto das memórias e qualquer texto livre.
 */
export function moneySources(p: {
  payloadInput: string;
  question: string;
  results: ToolResult[];
  memories?: ReadonlyMap<string, MemorySource>;
}): MoneySources {
  const { retrieval, catalog } = JSON.parse(p.payloadInput) as { retrieval?: unknown; catalog?: unknown };
  const numeric = p.results.filter((t) => t.chamada.name !== "search_memory" && t.chamada.name !== "notas");
  const simulated = numeric
    .filter((t) => t.chamada.name === "simular")
    .map((t) => String((t.resultado as { resultado?: unknown } | null)?.resultado ?? ""));
  const elsewhere = [
    formattedMoneyText([retrieval, catalog, numeric.filter((t) => t.chamada.name !== "padroes").map((t) => t.resultado)]),
    ...simulated,
  ].join("\n");
  const labeled = new Set(["padroes", "investigar_gastos", "simular_mudanca", "avisos_de_dados", "abertura", "proximas_decisoes"]);
  const unlabeled = [
    formattedMoneyText([retrieval, catalog, numeric.filter((t) => !labeled.has(t.chamada.name)).map((t) => t.resultado)]),
    ...simulated,
  ].join("\n");
  return {
    financial: [formattedMoneyText([retrieval, catalog, numeric.map((t) => t.resultado)]), ...simulated].join("\n"),
    declared: p.question,
    memories: p.memories,
    periods: patternPeriods(numeric, elsewhere),
    roles: moneyRoles(numeric, unlabeled),
  };
}

/**
 * Papel de cada valor quando dito como economia (MoneyRole). Só três
 * ferramentas rotulam: padroes (alavanca x diferença ou dinheiro movimentado),
 * investigar_gastos (descrição) e simular_mudanca (diferença calculada ou
 * hipotética). O resto fica "outro" e não muda nada do que já era aceito.
 */
export function moneyRoles(results: readonly ToolResult[], elsewhere: string): Map<string, Set<MoneyRole>> {
  const roles = new Map<string, Set<MoneyRole>>();
  const add = (formatted: unknown, role: MoneyRole) => {
    if (typeof formatted !== "string") return;
    for (const v of moneyIn(formatted)) (roles.get(v) ?? roles.set(v, new Set()).get(v)!).add(role);
  };
  const all = (value: unknown, role: MoneyRole) => {
    if (Array.isArray(value)) for (const x of value) all(x, role);
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) {
        if ((k === "formatted" || k.endsWith("_formatted")) && typeof v === "string") add(v, role);
        else all(v, role);
      }
  };
  for (const r of results) {
    const out = r.resultado as Record<string, unknown> | null;
    if (!out || typeof out !== "object") continue;
    if (r.chamada.name === "padroes") {
      for (const h of (out.destaques ?? []) as Record<string, unknown>[]) {
        // Alavanca de rotina depende de manter o hábito (hipotética, decisão de 22/11/2026); cancelar
        // uma recorrência tem preço conhecido (calculada).
        const levers = (h.alavancas ?? []) as Record<string, unknown>[];
        for (const l of levers) add(l.formatted, l.tipo === "cancelar_recorrencia" ? "economia" : "hipotetica");
        const top = levers.find((l) => l.formatted === h.em_jogo_formatted);
        add(h.em_jogo_formatted, h.em_jogo_natureza !== "alavanca" ? "nao_economia" : top?.tipo === "cancelar_recorrencia" ? "economia" : "hipotetica");
        all(h.base, "nao_economia");
        all(h.metades, "nao_economia");
      }
    } else if (r.chamada.name === "investigar_gastos" || r.chamada.name === "avisos_de_dados" || r.chamada.name === "abertura" || r.chamada.name === "proximas_decisoes") all(out, "nao_economia");
    else if (r.chamada.name === "simular_mudanca") {
      const kind = out.tipo_de_resultado;
      const role: MoneyRole = kind === "economia_calculada" ? "economia" : kind === "economia_hipotetica" ? "hipotetica" : "nao_economia";
      add(out.diferenca_mensal_formatted, role);
      add(out.diferenca_anual_estimada_formatted, role);
      all(Object.fromEntries(Object.entries(out).filter(([k]) => !k.startsWith("diferenca_"))), "outro");
    }
  }
  // Valor que também aparece em outra fonte (fatos, catálogo, outras ferramentas) não tem papel conferido.
  for (const v of moneyIn(elsewhere)) roles.get(v)?.add("outro");
  return roles;
}

/**
 * Proveniência do dinheiro, com UMA tentativa de reparo: o modelo recebe os
 * valores sem origem e reescreve usando os dados já obtidos (pode pedir no
 * máximo 1 ferramenta, se ainda houver orçamento). A reescrita passa de novo
 * pela checagem; o que ainda não tiver origem sai como afirmação inteira.
 * `contas` (Fase 3a) passa pelas mesmas fontes que o text. Sem tempo no
 * orçamento (trace.prazo), não há reparo: vai direto para a remoção.
 */
export async function verifyMoney(p: {
  text: string;
  contas?: string | null;
  payload: Payload;
  ctx: ToolContext;
  results: ToolResult[];
  trace: Trace;
  question: string;
  memories?: ReadonlyMap<string, MemorySource>;
  patterns?: ReadonlyMap<string, PatternRef>;
}): Promise<{ text: string; contas: string | null }> {
  const sources = () => moneySources({ payloadInput: p.payload.input, question: p.question, results: p.results, memories: p.memories });
  const checked = (text: string, contas: string | null) => {
    const r = checkMoney(text, sources());
    const c = contas ? checkMoney(contas, sources()) : null;
    p.trace.declarados = r.declared.length + (c?.declared.length ?? 0);
    const pat = checkPatterns(r.text, p.patterns ?? new Map());
    const patC = c ? checkPatterns(c.text, p.patterns ?? new Map()) : null;
    p.trace.padroes_sem_etiqueta = pat.untagged.length + (patC?.untagged.length ?? 0);
    const patterns = [...pat.rejected, ...(patC?.rejected ?? [])];
    const rejected = [...r.rejected, ...(c?.rejected ?? []), ...patterns];
    // Padrão sem base só pede reescrita; quem tira frase é só o dinheiro sem origem.
    return { text: pat.text, contas: patC?.text ?? null, replaced: rejected.length, rejected, money: r.replaced + (c?.replaced ?? 0), patterns };
  };
  const first = checked(p.text, p.contas ?? null);
  p.trace.sem_origem = first.rejected;
  if (!first.replaced) return { text: first.text, contas: first.contas };
  let candidate = first;
  if (Date.now() >= p.trace.prazo) p.trace.sem_tempo.push("reparo");
  else {
    p.trace.reparos++;
    try {
      const ask = (tools: number, extra: Record<string, unknown> = {}) =>
        requestLlm({
          ...p.payload,
          meter: p.trace.meter,
          inputTail: JSON.stringify({
            tool_results: p.results,
            ferramentas_restantes: tools,
            reparo: {
              resposta_anterior: p.text,
              ...(p.contas ? { contas_anterior: p.contas } : {}),
              valores_sem_origem: first.rejected,
              instrucao:
                "Estes valores ou padrões não têm origem: o valor não aparece em nenhum resultado nem fato, está com o período errado (total do período dito como por mês, ou o contrário), o valor foi dito como economia sem ser economia (diferença histórica ou dinheiro movimentado não são economia; economia hipotética vai com a condição), ou o padrão não tem a etiqueta {{pN}} de um destaque de padroes (ou {{iN}} de um resultado de investigar_gastos) que diga exatamente isso. Reescreva usando só valores formatados de tool_results ou dos fatos, com o período que eles têm, e etiquete cada padrão com o destaque certo; ou tire a afirmação. Se faltar um dado essencial, peça UMA ferramenta.",
            },
            ...extra,
          }),
        });
      let reply = classifyReply(await ask(Math.min(1, Math.max(0, p.trace.limite - p.trace.executadas - p.trace.invalidas))));
      if (reply.kind === "tool_call" && p.trace.executadas + p.trace.invalidas < p.trace.limite && Date.now() < p.trace.prazo) {
        p.trace.solicitadas++;
        const { result, repeated } = await runToolCached(p.ctx, reply.call);
        if (repeated) p.trace.repetidas++;
        else p.trace.executadas++;
        p.results.push({ chamada: reply.call, resultado: result });
        reply = classifyReply(await ask(0, { aviso: "Responda agora no formato final." }));
      }
      if (reply.kind === "final") {
        const second = checked(reply.text, reply.contas ?? null);
        p.trace.padroes_mantidos = second.patterns;
        if (!second.money) return { text: second.text, contas: second.contas };
        candidate = second;
      }
    } catch {
      // Reparo indisponível (provedor, ferramenta): segue para a remoção (só do dinheiro).
    }
  }
  if (!first.money && candidate.text === first.text) {
    p.trace.padroes_mantidos = first.patterns;
    return { text: first.text, contas: first.contas };
  }
  const repaired = repairFallback(candidate.text);
  const accounts = candidate.contas ? dropUnverified(candidate.contas) : null;
  p.trace.removidos += repaired.dropped + (accounts?.dropped ?? 0);
  if (repaired.kind === "empty") return { text: NO_VERIFIED_ANSWER, contas: null };
  const text = repaired.kind === "replaced" ? repaired.text : `${repaired.text}\n\n${OMITTED_NOTE}`;
  return { text, contas: repaired.kind === "replaced" ? null : accounts?.text || null };
}

export { PROTOCOL_FAILURE };
