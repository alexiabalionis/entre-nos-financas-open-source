// Relatório da avaliação da Judite: puro, sem rede. Usado pela execução e pela repontuação.
import { AXES, mean, pct, rates, type Axis, type Question, type Scores } from "./judite-eval-score.ts";

export type Trace = {
  tokens?: number;
  tokens_entrada?: number;
  tokens_saida?: number;
  tokens_do_cache?: number;
  idas_ao_modelo?: number;
  ms_no_modelo?: number;
  executadas?: number;
  solicitadas?: number;
  repetidas?: number;
  invalidas?: number;
  reparos?: number;
  removidos?: number;
  /** O que a 1ª versão da resposta afirmou sem origem (valores, períodos, padrões). */
  sem_origem?: string[];
  tokens_raciocinio?: number;
};
export type Adversarial = "obedeceu" | "reproduziu" | "descartou";
export type ScoresX = Scores & { adversarial?: Adversarial };
export type Result = { model: string; family: string; rep: number; question: Question; text: string; contas?: string | null; scores: ScoresX; trace: Trace | null; ms: number; tools: string; error: string };
export type Prices = { priceIn?: number; priceOut?: number };

const AXIS_LABEL: Record<Axis, string> = { safety: "segurança", money: "correção financeira", completeness: "completude", utility: "utilidade" };
const ADVERSARIAL: Adversarial[] = ["obedeceu", "reproduziu", "descartou"];

const row = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
const table = (head: string[], rows: (string | number)[][]) => [row(head), row(head.map(() => "---")), ...rows.map(row)].join("\n");

export function p90(xs: number[]): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
}

const sum = (rs: Result[], pick: (t: Trace) => number | undefined) => rs.reduce((s, r) => s + (r.trace ? (pick(r.trace) ?? 0) : 0), 0);
const avg = (rs: Result[], pick: (t: Trace) => number | undefined) => mean(rs.flatMap((r) => (r.trace ? [pick(r.trace) ?? 0] : [])));
const dec = (x: number) => x.toFixed(1);

function adversarialCell(rs: Result[]): string {
  const kinds = rs.flatMap((r) => (r.scores.adversarial ? [r.scores.adversarial] : []));
  if (!kinds.length) return "-";
  return ADVERSARIAL.map((k) => `${k} ${kinds.filter((x) => x === k).length}`).join(" / ");
}

function cost(rs: Result[], prices: Prices): string {
  if (prices.priceIn === undefined || prices.priceOut === undefined) return "-";
  const usd = (sum(rs, (t) => t.tokens_entrada) * prices.priceIn + sum(rs, (t) => t.tokens_saida) * prices.priceOut) / 1_000_000;
  return `US$ ${usd.toFixed(4)}`;
}

function inventedCell(rs: Result[]): string {
  const applicable = rs.filter((r) => r.scores.invented !== undefined);
  return applicable.length ? `${applicable.filter((r) => r.scores.invented).length} de ${applicable.length}` : "-";
}

function copilotoCell(rs: Result[]): string {
  const applicable = rs.filter((r) => r.scores.copiloto !== undefined);
  return applicable.length ? `${applicable.filter((r) => r.scores.copiloto === 1).length} de ${applicable.length}` : "-";
}

function metricCells(rs: Result[], prices: Prices): (string | number)[] {
  return [
    inventedCell(rs),
    copilotoCell(rs),
    adversarialCell(rs),
    dec(avg(rs, (t) => t.executadas)),
    dec(avg(rs, (t) => t.repetidas)),
    dec(avg(rs, (t) => t.invalidas)),
    dec(avg(rs, (t) => t.idas_ao_modelo)),
    dec(avg(rs, (t) => t.reparos)),
    sum(rs, (t) => t.tokens_entrada),
    sum(rs, (t) => t.tokens_saida),
    sum(rs, (t) => t.tokens_do_cache),
    cost(rs, prices),
    `${Math.round(mean(rs.map((r) => r.ms)))} / ${Math.round(p90(rs.map((r) => r.ms)))}`,
    `${Math.round(avg(rs, (t) => t.ms_no_modelo))} / ${Math.round(p90(rs.flatMap((r) => (r.trace ? [r.trace.ms_no_modelo ?? 0] : []))))}`,
  ];
}

const METRIC_HEAD = [
  "padrão inventado (respostas)",
  "copiloto ok (respostas)",
  "adversarial",
  "ferramentas executadas (média)",
  "repetidas (média)",
  "inválidas (média)",
  "idas ao modelo (média)",
  "reparos (média)",
  "tokens entrada",
  "tokens saída",
  "tokens do cache",
  "custo",
  "ms total (média / p90)",
  "ms no modelo (média / p90)",
];

export function render(all: Result[], models: string[], stopped: string, providerErrors: string[], prices: Prices = {}): string {
  const out: string[] = ["# Avaliação da Judite", ""];
  if (stopped) out.push(`**${stopped}**`, "");
  for (const model of models) {
    const mine = all.filter((r) => r.model === model);
    if (!mine.length) continue;
    out.push(`## ${model}`, "", "### Resumo por família", "");
    const families = [...new Set(mine.map((r) => r.family))];
    out.push(
      table(
        ["família", "respostas", ...AXES.map((a) => AXIS_LABEL[a]), ...METRIC_HEAD],
        families.map((f) => {
          const rs = mine.filter((r) => r.family === f);
          const rate = rates(rs.map((r) => r.scores));
          return [f, rs.length, ...AXES.map((a) => pct(rate[a])), ...metricCells(rs, prices)];
        }),
      ),
      "",
      "### Taxa por pergunta (média das repetições)",
      "",
    );
    out.push(
      table(
        ["id", "pergunta", ...AXES.map((a) => AXIS_LABEL[a]), ...METRIC_HEAD],
        [...new Map(mine.map((r) => [`${r.family}${r.question.id}`, r])).values()].map(({ family, question }) => {
          const rs = mine.filter((r) => r.family === family && r.question.id === question.id);
          const rate = rates(rs.map((r) => r.scores));
          return [question.id, question.q.slice(0, 60), ...AXES.map((a) => pct(rate[a])), ...metricCells(rs, prices)];
        }),
      ),
      "",
    );
  }
  if (providerErrors.length) out.push(`Erros do provedor: ${providerErrors.join("; ")}`, "");
  out.push("## Respostas das falhas", "");
  for (const r of all.filter((x) => x.scores.notes.length || x.error)) {
    out.push(
      `### ${r.model} · ${r.question.id} · repetição ${r.rep}`,
      "",
      `Pergunta: ${r.question.q}`,
      "",
      `Ferramentas: ${r.tools}`,
      "",
      `Notas: ${r.scores.notes.join("; ") || "-"}${r.error ? ` · erro: ${r.error}` : ""}`,
      "",
      "```",
      r.text,
      "```",
      "",
    );
  }
  return out.join("\n");
}
