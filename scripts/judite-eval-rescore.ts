// Repontua execuções salvas da Judite (work/judite-eval-runs/*.jsonl) sem chamar o provedor.
// Uso: npm run eval:judite:rescore -- [--price-in 0.5 --price-out 2] work/judite-eval-runs/arquivo.jsonl...
// Escreve <arquivo>.rescore.md ao lado de cada entrada.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { render, type Prices, type Result, type Trace } from "./judite-eval-report.ts";
import { ALL_SCENARIOS as SCENARIOS } from "./judite-eval-lacunas.ts";
import { scoreRun, type Question, type ToolResultLite } from "./judite-eval-score.ts";

/** Uma resposta gravada pela avaliação, uma por linha do jsonl. */
export type RunRecord = {
  model: string;
  family: string;
  rep: number;
  questionId: string;
  q: string;
  history: { role: "user" | "assistant"; text: string }[];
  text: string;
  contas?: string | null;
  toolResults: ToolResultLite[];
  payload: string;
  trace: Trace | null;
  ms: number;
  error: string;
};

export type Rescored = { results: Result[]; models: string[]; warnings: string[] };

/** Lê o jsonl tolerando cabeçalho e uma última linha cortada. */
export function parseRuns(content: string): { records: RunRecord[]; skipped: number } {
  const records: RunRecord[] = [];
  let skipped = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<RunRecord> & { meta?: unknown };
      if (value.meta !== undefined) continue;
      if (typeof value.questionId !== "string" || typeof value.model !== "string") {
        skipped++;
        continue;
      }
      records.push(value as RunRecord);
    } catch {
      skipped++;
    }
  }
  return { records, skipped };
}

export function rescore(content: string): Rescored {
  const { records, skipped } = parseRuns(content);
  const warnings: string[] = [];
  if (skipped) warnings.push(`${skipped} linha(s) ilegível(is) ignorada(s) (corte no fim do arquivo?).`);
  const questions = new Map<string, Question>(SCENARIOS.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
  const results: Result[] = [];
  const missing = new Set<string>();
  for (const r of records) {
    const question = questions.get(r.questionId);
    if (!question) {
      missing.add(r.questionId);
      continue;
    }
    const history = (r.history ?? []).map((h) => h.text).join("\n");
    results.push({
      model: r.model,
      family: r.family,
      rep: r.rep,
      question,
      text: r.text,
      scores: scoreRun(question, { text: r.text, contas: r.contas, toolResults: r.toolResults, payload: r.payload, question: question.q, history, semOrigem: r.trace?.sem_origem }),
      trace: r.trace,
      ms: r.ms,
      tools: r.toolResults.map((t) => t.chamada.name).join(", ") || "-",
      error: r.error,
    });
  }
  for (const id of missing) warnings.push(`pergunta ${id} não existe mais nos cenários: respostas puladas.`);
  return { results, models: [...new Set(results.map((r) => r.model))], warnings };
}

export function renderRescore(content: string, prices: Prices = {}): string {
  const { results, models, warnings } = rescore(content);
  const body = render(results, models, "", [], prices);
  return warnings.length ? body.replace("# Avaliação da Judite\n", `# Avaliação da Judite\n\n${warnings.map((w) => `> ${w}`).join("\n")}\n`) : body;
}

async function main() {
  globalThis.fetch = (() => {
    throw new Error("repontuação não usa rede");
  }) as typeof fetch;
  const argv = process.argv.slice(2);
  const files: string[] = [];
  const prices: Prices = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--price-in") prices.priceIn = Number(argv[++i]);
    else if (argv[i] === "--price-out") prices.priceOut = Number(argv[++i]);
    else files.push(argv[i]);
  }
  if (!files.length) throw new Error("Passe os arquivos: scripts/judite-eval-rescore.ts [--price-in N --price-out N] arquivo.jsonl...");
  for (const file of files) {
    const out = file.replace(/\.jsonl$/, "") + ".rescore.md";
    await writeFile(out, renderRescore(await readFile(file, "utf8"), prices));
    console.log(`Repontuado: ${out}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
