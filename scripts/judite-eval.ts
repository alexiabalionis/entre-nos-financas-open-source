// Avaliação da Judite com modelos de verdade, sobre famílias FICTÍCIAS em
// memória (nenhum dado real sai daqui). A chave do provedor vem do ambiente de
// quem roda; o script não imprime a chave.
//
// Uso (DashScope):
//   AI_PROVIDER=dashscope DASHSCOPE_API_KEY=... DASHSCOPE_RETENTION_CONFIRMED=true \
//   npm run eval:judite -- --reps 3 --families A,B,C qwen3.8-flash
//
// Cada modelo responde às mesmas perguntas, N vezes, em famílias novas a cada
// repetição (o limite de 20 perguntas externas por pessoa vale por família).
// Saída: tabelas no terminal e o relatório completo em work/judite-eval-<data>.md.
// Cada resposta também vai, na hora, para work/judite-eval-runs/<data>T<hora>-<modelo>.jsonl
// (repontuável com npm run eval:judite:rescore).
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDatabase } from "../src/server/db.ts";
import { askHelp } from "../src/server/help.ts";
import { render, type Prices, type Result, type Trace } from "./judite-eval-report.ts";
import { ALL_SCENARIOS as SCENARIOS } from "./judite-eval-lacunas.ts";
import { scoreRun, type Scores, type ToolResultLite } from "./judite-eval-score.ts";

const QUOTA = /Quota|HTTP (402|403|429)/i;

function args() {
  const argv = process.argv.slice(2);
  const models: string[] = [];
  let reps = 1;
  let families = SCENARIOS.map((s) => s.id as string);
  let only: Set<string> | null = null;
  let route = false;
  const openModels: string[] = [];
  const prices: Prices = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--price-in") prices.priceIn = Number(argv[++i]);
    else if (argv[i] === "--price-out") prices.priceOut = Number(argv[++i]);
    else if (argv[i] === "--reps") reps = Math.max(1, Number(argv[++i]) || 1);
    else if (argv[i] === "--families") families = (argv[++i] ?? "").split(",").map((f) => f.trim().toUpperCase());
    // Só estas perguntas (ex.: B09,C08): para rodar os cenários afetados.
    // Com --route, o diagnóstico aberto vai para DASHSCOPE_OPEN_MODEL (padrão qwen4-max, nativo), como em produção.
    else if (argv[i] === "--route") route = true;
    // Com --route: um ou mais modelos da rota aberta, cada um com o sufixo do perfil (ex.: qwen4-max,qwen4-max:thinking-low,qwen3.8-27b:thinking-low).
    else if (argv[i] === "--open-models") openModels.push(...(argv[++i] ?? "").split(",").map((m) => m.trim()).filter(Boolean));
    else if (argv[i] === "--only") only = new Set((argv[++i] ?? "").split(",").map((q) => q.trim().toUpperCase()));
    else models.push(argv[i]);
  }
  if (models.length === 0) throw new Error("Passe os modelos: scripts/judite-eval.ts [--reps 3] [--families A,B,C] [--only B09,C08] [--route [--open-models a,b]] modelo-a modelo-b");
  return { models, reps, families, prices, only, route, openModels };
}

/**
 * O corpo enviado, como lista de mensagens do Chat Completions: a Responses API
 * (Grok) manda `input` com itens function_call e function_call_output.
 */
function messagesOf(body: string | undefined): { messages: Record<string, unknown>[]; tools?: unknown[]; tool_choice?: string } {
  let req: Record<string, unknown> = {};
  try {
    req = JSON.parse(body ?? "{}");
  } catch {
    return { messages: [] };
  }
  if (Array.isArray(req.messages)) return req as { messages: Record<string, unknown>[] };
  const messages: Record<string, unknown>[] = [];
  for (const it of (Array.isArray(req.input) ? req.input : []) as Record<string, unknown>[]) {
    if (it.type === "function_call") {
      const call = { id: it.call_id, type: "function", function: { name: it.name, arguments: it.arguments } };
      const last = messages.at(-1);
      if (last?.role === "assistant" && Array.isArray(last.tool_calls)) last.tool_calls.push(call);
      else messages.push({ role: "assistant", content: "", tool_calls: [call] });
    } else if (it.type === "function_call_output") messages.push({ role: "tool", tool_call_id: it.call_id, content: it.output });
    else if (it.role) messages.push({ role: it.role, content: it.content });
  }
  return { messages, tools: req.tools as unknown[] | undefined, tool_choice: req.tool_choice as string | undefined };
}

/**
 * Modo nativo: todos os resultados de ferramenta que o modelo recebeu nesta ida,
 * na ordem (mensagens do usuário com tool_results e mensagens "tool" pelo id).
 */
function nativeResults(body: string | undefined): ToolResultLite[] {
  try {
    const msgs = messagesOf(body).messages;
    if (!msgs.some((m) => m.role === "tool")) return [];
    const calls = new Map<string, Record<string, unknown>>();
    const out: ToolResultLite[] = [];
    const text = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? "").join("\n") : "");
    for (const m of msgs) {
      if (m.role === "assistant")
        for (const tc of (m.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[]) {
          let a: Record<string, unknown> = {};
          try {
            a = JSON.parse(tc.function.arguments || "{}");
          } catch {
            // argumento inválido: fica só o nome
          }
          calls.set(tc.id, { ...a, name: tc.function.name });
        }
      if (m.role === "tool") {
        const call = calls.get(String(m.tool_call_id));
        let resultado: unknown = null;
        try {
          resultado = JSON.parse(text(m.content));
        } catch {
          resultado = text(m.content);
        }
        if (call) out.push({ chamada: call as ToolResultLite["chamada"], resultado });
      }
      if (m.role === "user")
        for (const part of text(m.content).split("\n"))
          try {
            out.push(...((JSON.parse(part) as { tool_results?: ToolResultLite[] }).tool_results ?? []));
          } catch {
            // parte que não é JSON
          }
    }
    return out;
  } catch {
    return [];
  }
}

/** Texto de uma mensagem do usuário enviada ao provedor (string ou partes). */
function userText(body: string | undefined): string {
  const content = (messagesOf(body).messages.find((m) => m.role === "user")?.content ?? "") as string | { text: string }[];
  return typeof content === "string" ? content : content.map((p) => p.text).join("\n");
}

/**
 * Uma ida ao provedor, para a auditoria de latência: caracteres de cada parte
 * do pedido (system, ferramentas, a entrada fixa da pergunta e a conversa que
 * cresce), o uso que o provedor contou, o tempo e o que voltou. Famílias
 * fictícias: o texto cru da resposta final pode ser gravado.
 */
async function idaOf(body: string | undefined, res: Response, ms: number): Promise<Record<string, unknown>> {
  const size = (c: unknown) => (typeof c === "string" ? c.length : JSON.stringify(c ?? "").length);
  const req = messagesOf(body);
  const msgs = req.messages;
  const rest = msgs.slice(2);
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");
  const tail = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content ?? "");
  const kind = /\\?"reparo\\?":/.test(tail)
    ? "reparo"
    : /Confira as hip/.test(tail)
      ? "volta_hipoteses"
      : /vai buscar ou analisar/.test(tail)
        ? "volta_anuncio"
        : /Chegou evidência nova/.test(tail)
          ? "volta_evidencia"
          : "rodada";
  type Usage = {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  const out = (await res.json().catch(() => ({}))) as {
    choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
    // Responses API (Grok)
    status?: string;
    output?: { type: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] }[];
    usage?: Usage;
  };
  const choice = out.choices?.[0];
  const calls = out.output
    ? out.output.filter((o) => o.type === "function_call").map((o) => ({ function: { name: String(o.name), arguments: String(o.arguments ?? "") } }))
    : (choice?.message?.tool_calls ?? []);
  const text = out.output
    ? out.output.filter((o) => o.type === "message").flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("\n")
    : String(choice?.message?.content ?? "");
  const u = out.usage ?? {};
  return {
    kind,
    system_chars: size(msgs[0]?.content),
    input_chars: size(msgs[1]?.content),
    convo_chars: rest.reduce((s, m) => s + size(m.content) + size(m.tool_calls ?? ""), 0),
    convo_tool_chars: rest.filter((m) => m.role === "tool").reduce((s, m) => s + size(m.content), 0),
    tools_chars: req.tools ? JSON.stringify(req.tools).length : 0,
    tool_choice: req.tool_choice ?? null,
    prompt_tokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0,
    completion_tokens: u.completion_tokens ?? u.output_tokens ?? 0,
    reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? u.output_tokens_details?.reasoning_tokens ?? 0,
    ms,
    finish: choice?.finish_reason ?? out.status ?? null,
    tool_calls: calls.map((c) => ({ name: c.function.name, args: c.function.arguments })),
    ...(calls.length ? {} : { content: text.slice(0, 8000) }),
  };
}

async function main() {
  const { models, reps, families, prices, only, route, openModels } = args();
  // Sem --route, cada pergunta vai ao modelo pedido (comparação justa entre modelos).
  if (!route) process.env.DASHSCOPE_OPEN_MODEL = "off";
  const provider = process.env.AI_PROVIDER;
  const modelVar = provider === "groq" ? "GROQ_MODEL" : provider === "dashscope" ? "DASHSCOPE_MODEL" : provider === "grok" || provider === "xai" ? "GROK_MODEL" : "OPENAI_MODEL";
  process.env[modelVar] = models[0];
  const { helpStatus } = await import("../src/server/help.ts");
  if (!helpStatus().externalReady)
    throw new Error(
      `IA externa não configurada (AI_PROVIDER=${provider ?? "vazio"}). No DashScope são precisos AI_PROVIDER=dashscope, DASHSCOPE_API_KEY e DASHSCOPE_RETENTION_CONFIRMED=true; no Grok (xAI), AI_PROVIDER=grok, GROK_API_KEY (ou XAI_API_KEY) e GROK_RETENTION_CONFIRMED=true, no .env.local (ou no ambiente).`,
    );

  // Captura por pergunta, sem tocar no app: payload da primeira ida e os
  // tool_results da ida que mais acumulou.
  let payload = "";
  let toolResults: ToolResultLite[] = [];
  // Cada ida ao provedor (só famílias fictícias): tamanho de cada parte do pedido, uso, tempo e o que voltou.
  let idas: Record<string, unknown>[] = [];
  const providerErrors = new Set<string>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const body = (args[1] as { body?: string } | undefined)?.body;
    const text = userText(body);
    if (!payload) payload = text;
    for (const part of text.split("\n"))
      try {
        const found = (JSON.parse(part) as { tool_results?: ToolResultLite[] }).tool_results;
        if (found && found.length >= toolResults.length) toolResults = found;
      } catch {
        // parte que não é JSON
      }
    // Function Calling nativo: os resultados vão em mensagens "tool", casadas com a chamada pelo id.
    const native = nativeResults(body);
    if (native.length >= toolResults.length) toolResults = native;
    const started = Date.now();
    const res = await realFetch(...args);
    if (!res.ok)
      void res
        .clone()
        .text()
        .then((t) => providerErrors.add(`HTTP ${res.status} ${/"code"\s*:\s*"([^"]+)"/.exec(t)?.[1] ?? ""}`.trim()))
        .catch(() => {});
    else idas.push(await idaOf(body, res.clone(), Date.now() - started));
    return res;
  }) as typeof fetch;

  const db = await openDatabase(); // em memória
  const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
  const results: Result[] = [];
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date()).replace(" ", "T").replaceAll(":", "");
  const runFiles = new Map<string, string>();
  await mkdir(path.join("work", "judite-eval-runs"), { recursive: true });
  // Com --open-models, cada modelo de base roda uma vez por modelo da rota aberta (só com --route).
  const variants = models.flatMap((m) => (route && openModels.length ? openModels.map((o) => ({ base: m, open: o, label: `${m}+aberta=${o}` })) : [{ base: m, open: null as string | null, label: m }]));
  // As variáveis dos experimentos (SPEC parte 6) ficam no cabeçalho de cada .jsonl.
  const flags = {
    JUDITE_OPEN_ROUTE: "open",
    JUDITE_FORMAT: "principios",
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^JUDITE_/.test(k))),
  };
  for (const v of variants) {
    const file = path.join("work", "judite-eval-runs", `${stamp}-${v.label.replace(/[^\w.-]+/g, "_")}.jsonl`);
    runFiles.set(v.label, file);
    await writeFile(file, `${JSON.stringify({ meta: { data: stamp, modelos: models, aberta: v.open, familias: families, reps, flags } })}\n`);
  }
  let n = 0;
  let stopped = "";
  outer: for (const v of variants) {
    const model = v.label;
    process.env[modelVar] = v.base;
    if (v.open) process.env.DASHSCOPE_OPEN_MODEL = v.open;
    for (let rep = 1; rep <= reps; rep++)
      for (const scenario of SCENARIOS.filter((s) => families.includes(s.id))) {
        const user = await scenario.build(db, n++);
        for (const question of scenario.questions.filter((q) => !only || only.has(q.id.toUpperCase()))) {
          payload = "";
          toolResults = [];
          idas = [];
          const t0 = Date.now();
          let r: Result;
          try {
            const a = (await askHelp(db, user, { question: question.q, month, currency: "BRL", external: true, chat: true, history: question.history ?? [] })) as {
              text: string;
              contas?: string | null;
              source: string;
              trace?: Trace;
            };
            const history = (question.history ?? []).map((h) => h.text).join("\n");
            r = {
              model,
              family: scenario.id,
              rep,
              question,
              text: a.text,
              contas: a.contas,
              scores: scoreRun(question, { text: a.text, contas: a.contas, toolResults, payload, question: question.q, history, semOrigem: a.trace?.sem_origem }),
              trace: a.trace ?? null,
              ms: Date.now() - t0,
              tools: toolResults.map((t) => t.chamada.name).join(", ") || "-",
              error: "",
            };
          } catch (e) {
            const none: Scores = { safety: 1, money: 0, completeness: 0, utility: 0, notes: ["erro na pergunta"] };
            r = { model, family: scenario.id, rep, question, text: "", scores: none, trace: null, ms: Date.now() - t0, tools: "-", error: e instanceof Error ? e.message : String(e) };
          }
          results.push(r);
          await appendFile(
            runFiles.get(model) ?? "",
            `${JSON.stringify({ model, family: scenario.id, rep, questionId: question.id, q: question.q, history: question.history ?? [], text: r.text, contas: r.contas, toolResults, payload, trace: r.trace, ms: r.ms, error: r.error, idas })}\n`,
          );
          process.stdout.write(".");
          if ([...providerErrors].some((e) => QUOTA.test(e))) {
            stopped = `Erro de cota/limite do provedor (${[...providerErrors].join("; ")}). Avaliação interrompida.`;
            break outer;
          }
        }
      }
  }
  console.log("\n");
  await db.close();

  // Mesmo carimbo do .jsonl: uma rodada nunca sobrescreve a anterior.
  const file = path.join("work", `judite-eval-${stamp}.md`);
  await mkdir("work", { recursive: true });
  const report = render(results, [...runFiles.keys()], stopped, [...providerErrors], prices);
  await writeFile(file, report);
  await writeFile(file.replace(/\.md$/, ".json"), JSON.stringify(results.map((r) => ({ ...r, question: r.question.id })), null, 1));
  console.log(report.split("\n## Respostas das falhas")[0]);
  console.log(`Relatório completo: ${path.resolve(file)}`);
}

await main();
