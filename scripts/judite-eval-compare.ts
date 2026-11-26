// Compara rodadas da avaliação (arquivos .jsonl de work/judite-eval-runs/) nas
// métricas de conclusão sustentada. Puro sobre o que foi gravado: sem modelo.
//
//   node --experimental-strip-types scripts/judite-eval-compare.ts A=arquivo.jsonl B=outro.jsonl [--only F02A]
import { readFileSync } from "node:fs";
import { checkMoney, moneyIn } from "../src/domain/money-check.ts";
import { moneySources, NO_VERIFIED_ANSWER, type ToolResult } from "../src/server/judite-loop.ts";
import { PROTOCOL_FAILURE } from "../src/server/judite-protocol.ts";
import { ALL_SCENARIOS } from "./judite-eval-lacunas.ts";
import { scoreRun, type Question } from "./judite-eval-score.ts";

const QUESTIONS = new Map<string, Question>(ALL_SCENARIOS.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
// Resposta que o usuário não aproveita: erro do provedor, falha de protocolo ou tudo tirado pelos validadores.
const LOST = (r: Row) => !!r.error || r.text.includes(PROTOCOL_FAILURE) || r.text.includes(NO_VERIFIED_ANSWER) || /^Não consegui conferir um dos números/.test(r.text);

type Row = {
  questionId?: string;
  model: string;
  text: string;
  toolResults: ToolResult[];
  payload: string;
  q: string;
  ms: number;
  error?: string | null;
  history?: { role: string; text: string }[];
  trace?: Record<string, unknown> & { tokens?: number; hipoteses?: { status: string }[] | null };
};

const SAVING = /econom\w*|poupa\w*|devolv\w*|\bvolta(ria|r)?\b/i;
const PIX_HIDES = /escond\w*|mascar\w*|rastre\w*|dificult\w*[^.\n]{0,30}acompanh\w*|perde[^.\n]{0,20}controle/i;
const PSYCH = /impuls\w*|compuls\w*|ansiedade|emocional|descontrole|falta de controle/i;
const CONSEQUENCE = /pouco colch\w*|aperto|faltar dinheiro|deix\w* pouco|imprevist\w*|compromet\w* (o |a )?(orçamento|caixa|fluxo)/i;
const RULERS = new Set(["mes_atual", "falta_pagar", "cartoes", "simular_mudanca", "simular", "sobra_atual"]);
const sentences = (t: string) => t.split(/(?<=[.!?])\s+|\n+/);

function metrics(rows: Row[]) {
  const n = rows.length || 1;
  const has = (r: Row, name: string) => r.toolResults.some((t) => t.chamada.name === name);
  const investigatedOps = (r: Row) => r.toolResults.some((t) => t.chamada.name === "investigar_gastos" && ["ciclo_salario", "parcelas"].some((o) => ((t.chamada as { operacoes?: string[] }).operacoes ?? []).includes(o)));
  let falseSaving = 0, savingNoSim = 0, pixHides = 0, psych = 0, consequenceNoRuler = 0, effort = 0, hyp = 0, concluded = 0;
  for (const r of rows) {
    // O papel do dinheiro conferido do mesmo jeito da produção, sobre o texto final gravado.
    const check = checkMoney(r.text, moneySources({ payloadInput: (r.payload || "{}").split("\n")[0]!, question: r.q, results: r.toolResults }));
    if (check.rejected.some((x) => /não é economia|diferença histórica|hipotética dita sem/.test(x))) falseSaving++;
    const savingWithMoney = sentences(r.text).some((s) => SAVING.test(s) && moneyIn(s).size > 0);
    if (savingWithMoney && !has(r, "simular_mudanca")) savingNoSim++;
    if (sentences(r.text).some((s) => /pix/i.test(s) && PIX_HIDES.test(s)) || (/pix/i.test(r.text) && PIX_HIDES.test(r.text))) pixHides++;
    if (PSYCH.test(r.text)) psych++;
    if (CONSEQUENCE.test(r.text) && !investigatedOps(r) && !r.toolResults.some((t) => RULERS.has(t.chamada.name) && t.chamada.name !== "sobra_atual")) consequenceNoRuler++;
    if (/esfor[cç]o/i.test(r.text)) effort++;
    const h = r.trace?.hipoteses ?? null;
    if (h?.length) {
      hyp++;
      if (h.some((x) => x.status === "confirmada" || x.status === "nao_sustentada")) concluded++;
    }
  }
  const pct = (k: number) => `${Math.round((k / n) * 100)}%`;
  const scored = rows.flatMap((r) => {
    const q = r.questionId ? QUESTIONS.get(r.questionId) : undefined;
    if (!q || r.error) return [];
    return [scoreRun(q, { text: r.text, toolResults: r.toolResults as never, payload: r.payload, question: r.q, history: JSON.stringify(r.history ?? []), semOrigem: r.trace?.sem_origem as string[] | undefined })];
  });
  const avg = (f: (s: (typeof scored)[number]) => number) => (scored.length ? `${Math.round((scored.reduce((t, s) => t + f(s), 0) / scored.length) * 100)}%` : "-");
  return {
    respostas: rows.length,
    "sucesso ponta a ponta": pct(rows.filter((r) => !LOST(r)).length),
    "erro do provedor": pct(rows.filter((r) => r.error).length),
    "falha de protocolo": pct(rows.filter((r) => r.text?.includes(PROTOCOL_FAILURE)).length),
    "erros de formato (total)": rows.reduce((t, r) => t + Number(r.trace?.protocolo ?? 0), 0),
    "chamadas nativas (média)": (rows.reduce((t, r) => t + Number(r.trace?.nativas ?? 0), 0) / n).toFixed(1),
    "idas ao modelo (média)": (rows.reduce((t, r) => t + Number(r.trace?.idas_ao_modelo ?? 0), 0) / n).toFixed(1),
    "correção financeira": avg((s) => s.money),
    completude: avg((s) => s.completeness),
    utilidade: avg((s) => s.utility),
    padroes: pct(rows.filter((r) => has(r, "padroes")).length),
    investigar: pct(rows.filter((r) => has(r, "investigar_gastos")).length),
    simular: pct(rows.filter((r) => has(r, "simular_mudanca")).length),
    "ferramentas (média)": (rows.reduce((s, r) => s + r.toolResults.length, 0) / n).toFixed(1),
    "economia falsa": pct(falseSaving),
    "economia sem simulação": pct(savingNoSim),
    "Pix esconde/rastreio": pct(pixHides),
    "motivo psicológico": pct(psych),
    "consequência sem régua": pct(consequenceNoRuler),
    "fala de esforço": pct(effort),
    "com hipóteses": pct(hyp),
    "hipótese concluída c/ investigação": pct(concluded),
    "tokens (média)": Math.round(rows.reduce((s, r) => s + (r.trace?.tokens ?? 0), 0) / n),
    "ms (média)": Math.round(rows.reduce((s, r) => s + r.ms, 0) / n),
  };
}

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? new Set(argv[onlyAt + 1]!.split(",").map((s) => s.toUpperCase())) : null;
const runs = argv.filter((a, i) => a.includes("=") && (onlyAt < 0 || i !== onlyAt + 1)).map((a) => a.split("=") as [string, string]);
const table = runs.map(([label, file]) => {
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row)
    .filter((r) => r.questionId && (!only || only.has(r.questionId.toUpperCase())));
  return { label, ...metrics(rows) };
});
const keys = Object.keys(table[0] ?? {});
console.log(`| ${keys.join(" | ")} |\n| ${keys.map(() => "---").join(" | ")} |`);
for (const row of table) console.log(`| ${keys.map((k) => String((row as Record<string, unknown>)[k])).join(" | ")} |`);
