// Auditoria determinística da ferramenta padroes (M1), sobre as famílias
// FICTÍCIAS da avaliação. Sem modelo e sem rede: monta cada família em memória,
// chama `padroes` com o rastreio ligado e resume o que se perdeu no caminho.
//
//   npm run audit:padroes            (todas as famílias com 6 meses)
//   npm run audit:padroes -- F01 F03 (só estas)
//
// Saída: um rastreio completo por família em work/padroes-trace/ e o resumo em
// work/padroes-audit-<execução>.md e .json (work/ fica fora do git).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDatabase } from "../src/server/db.ts";
import { runTool } from "../src/server/judite-tools.ts";
import type { ToolContext } from "../src/server/judite-tools.ts";
import { ALL_SCENARIOS, catalogFor } from "./judite-eval-copiloto.ts";

type Candidate = {
  analise: string;
  recorte: { tipo: string; chave: string };
  variante: string | null;
  status: "aprovado" | "rejeitado";
  motivo: string | null;
  corte: string | null;
  evidencia: Record<string, unknown> | null;
  base: { compras: number };
  corte_ids: string[] | null;
};
type Selection = { posicao: number; chave: string; em_jogo_cents: string; status: string; absorvido_por: string | null };
type Overlap = { a: string; b: string; jaccard: number; cobertura: number; relacao: string };
type Trace = { candidatos: Candidate[]; selecao: Selection[]; sobreposicoes: Overlap[]; universo: Record<string, unknown> };

// O que em_jogo significa em cada análise (lido do código, spend-patterns-*.ts).
const EM_JOGO: Record<string, "alavanca" | "movimentado" | "diferenca"> = {
  concentracao_tempo: "alavanca",
  compras_pequenas: "alavanca",
  recorrencia_escondida: "alavanca",
  tendencia: "diferenca",
  lugares: "movimentado",
  comprometimento: "movimentado",
  forma_pagamento: "movimentado",
  ritmo_salario: "diferenca",
  dias_fora_da_curva: "diferenca",
};

/** Sinais de falso positivo que o código consegue ver sem interpretar. */
function suspects(t: Trace, salaryDays: number[]) {
  const out: string[] = [];
  const sent = new Set(t.selecao.filter((s) => s.status === "enviado").map((s) => s.chave));
  for (const c of t.candidatos.filter((x) => x.status === "aprovado")) {
    const key = [c.analise, c.recorte.tipo, c.recorte.chave, c.corte ?? ""].join(" | ");
    const flag = sent.has(key) ? "enviado" : "não enviado";
    if (c.analise === "ritmo_salario")
      out.push(`${key} (${flag}): gastar logo depois do salário é o esperado; o detector não olha se faltou dinheiro depois.`);
    if (c.analise === "concentracao_tempo" && /parte_do_mes|semana_do_mes/.test(c.corte ?? "") && salaryDays.length)
      out.push(`${key} (${flag}): salário no dia ${salaryDays.join(", ")}; a concentração no calendário ignora o ciclo do salário.`);
    if (c.analise === "forma_pagamento") {
      const g = (c.evidencia?.gasto_por_mes_cents ?? []) as number[];
      const change = g.length === 2 && g[0] ? g[1]! / g[0] - 1 : null;
      out.push(`${key} (${flag}): gasto por mês ${g.map((x) => Math.round(x / 100)).join(" → ")} reais (${change === null ? "?" : `${Math.round(change * 100)}%`}); em_jogo = parte mudada × gasto, não economia.`);
    }
    if (c.analise === "lugares" || c.analise === "comprometimento")
      out.push(`${key} (${flag}): em_jogo é dinheiro movimentado por mês, sem alavanca de economia.`);
  }
  return out;
}

async function main() {
  const only = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
  const runId = randomUUID();
  const dir = path.join(process.cwd(), "work", "padroes-trace", runId.slice(0, 8));
  process.env.JUDITE_PATTERNS_TRACE = "1";
  process.env.JUDITE_PATTERNS_TRACE_DIR = dir;
  const db = await openDatabase();
  const report: Record<string, unknown>[] = [];
  const md: string[] = [`# Auditoria de padroes (execução ${runId})`, "", "Famílias fictícias, sem modelo. Gerado por scripts/judite-patterns-audit.ts.", ""];
  for (const s of ALL_SCENARIOS) {
    if (only.size ? !only.has(s.id) : !/^(E|F\d+)$/.test(s.id)) continue;
    const user = await s.build(db, 0);
    const catalog = await catalogFor(db, user);
    const ctx: ToolContext = { db, user, catalog, currency: "BRL", cache: {} };
    const before = Date.now();
    let error: string | null = null;
    try {
      await runTool(ctx, { name: "padroes" });
    } catch (e) {
      error = (e as Error).message;
    }
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort();
    const file = files.length ? path.join(dir, files[files.length - 1]!) : null;
    const t = file ? (JSON.parse(await readFile(file, "utf8")) as Trace) : null;
    md.push(`## ${s.label}`, "");
    if (!t?.candidatos) {
      md.push(`Sem rastreio de candidatos${error ? ` (${error})` : ""}.`, "");
      report.push({ familia: s.id, erro: error });
      continue;
    }
    const approved = t.candidatos.filter((c) => c.status === "aprovado");
    const reasons: Record<string, number> = {};
    for (const c of t.candidatos.filter((x) => x.status === "rejeitado")) reasons[c.motivo ?? "?"] = (reasons[c.motivo ?? "?"] ?? 0) + 1;
    const byStatus: Record<string, number> = {};
    for (const x of t.selecao) byStatus[x.status] = (byStatus[x.status] ?? 0) + 1;
    const relations: Record<string, number> = {};
    for (const o of t.sobreposicoes) relations[o.relacao] = (relations[o.relacao] ?? 0) + 1;
    const sent = t.selecao.filter((x) => x.status === "enviado");
    const salaryDays = [...new Set(((t.universo.datas_de_salario ?? []) as string[]).map((d) => Number(d.slice(8))))];
    const sus = suspects(t, salaryDays);
    const droppedSpecific = t.sobreposicoes.filter(
      (o) => o.relacao === "contido" && t.selecao.some((x) => x.status !== "enviado" && (x.chave === o.a || x.chave === o.b)),
    );
    md.push(
      `- candidatos: ${t.candidatos.length} (aprovados ${approved.length}); rejeições: ${Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(", ") || "nenhuma"}`,
      `- seleção: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(", ") || "nada aprovado"}`,
      `- sobreposições entre aprovados: ${Object.entries(relations).map(([k, v]) => `${k} ${v}`).join(", ") || "nenhuma"}`,
      `- enviados (ordem por em_jogo):`,
      ...sent.map((x) => `  - ${x.chave} — em_jogo R$ ${Number(x.em_jogo_cents) / 100} (${EM_JOGO[x.chave.split(" | ")[0]!] ?? "?"})`),
      ...(t.selecao.filter((x) => x.status !== "enviado").length
        ? ["- fora da resposta:", ...t.selecao.filter((x) => x.status !== "enviado").map((x) => `  - ${x.chave} — ${x.status}${x.absorvido_por ? ` por ${x.absorvido_por}` : ""}`)]
        : []),
      ...(sus.length ? ["- suspeitas de falso positivo ou de dinheiro movimentado:", ...sus.map((x) => `  - ${x}`)] : []),
      ...(droppedSpecific.length ? ["- específicos contidos num agregado e que ficaram de fora:", ...droppedSpecific.map((o) => `  - ${o.a} ⊂/⊃ ${o.b}`)] : []),
      `- tempo: ${Date.now() - before} ms; rastreio: ${file ? path.relative(process.cwd(), file) : "—"}`,
      "",
    );
    report.push({ familia: s.id, candidatos: t.candidatos.length, aprovados: approved.length, rejeicoes: reasons, selecao: byStatus, sobreposicoes: relations, suspeitas: sus, rastreio: file });
  }
  await mkdir(path.join(process.cwd(), "work"), { recursive: true });
  const base = path.join(process.cwd(), "work", `padroes-audit-${runId.slice(0, 8)}`);
  await writeFile(`${base}.md`, md.join("\n"), { mode: 0o600 });
  await writeFile(`${base}.json`, JSON.stringify({ formato: 1, execucao: runId, familias: report }, null, 2), { mode: 0o600 });
  console.log(md.join("\n"));
  console.log(`\n${path.relative(process.cwd(), base)}.md`);
  await db.close();
}

await main();
