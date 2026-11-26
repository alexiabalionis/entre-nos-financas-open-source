import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForProvider } from "../src/domain/prompt-privacy.ts";
import { KNOWN_LIMITATIONS, SENSITIVE, renderReport, runAudit, type Label } from "../scripts/judite-payload-audit.ts";

const report = await runAudit();

test("auditoria: o provedor simulado recebeu várias rodadas de ferramentas", () => {
  assert.ok(report.bodies >= 18);
  assert.ok(report.campos.some((c) => c.caminho.startsWith("$.tool_results[].resultado")));
});

test("auditoria: nenhuma detecção de CPF, CNPJ, cartão, telefone, email ou nome após Pix", () => {
  assert.deepEqual(report.bloqueantes, []);
  assert.deepEqual(report.deteccoes, []);
});

test("auditoria: valores sensíveis conhecidos não saem, exceto as limitações conhecidas", () => {
  const present = new Map(report.presentes.map((p) => [p.rotulo, p.caminhos]));
  for (const label of Object.keys(SENSITIVE) as Label[])
    if (!KNOWN_LIMITATIONS.includes(label)) assert.equal(present.has(label), false, `${label} vazou`);
  // limitação conhecida: nome solto em texto livre não é detectável com segurança
  assert.ok(present.get("nome_solto")?.includes("$.history[].text"));
  assert.ok(present.get("nome_solto")?.includes("$.tool_results[].resultado.memorias[].texto"));
  // limitação conhecida: nome em minúsculas depois de "pix" não é reconhecido como nome próprio
  assert.ok(present.get("nome_pix_minusculo")?.includes("$.history[].text"));
  assert.equal(
    sanitizeForProvider(`pix enviado ${SENSITIVE.nome_pix_minusculo}`),
    `pix enviado ${SENSITIVE.nome_pix_minusculo}`,
  );
});

test("auditoria: todo caminho de texto livre tem finalidade", () => {
  assert.ok(report.textoLivre.length > 0);
  for (const t of report.textoLivre) assert.notEqual(t.finalidade, "não classificado", t.caminho);
});

test("auditoria: o relatório não contém valores brutos", () => {
  const text = renderReport(report);
  for (const value of Object.values(SENSITIVE)) assert.equal(text.toLowerCase().includes(value.toLowerCase()), false);
  assert.match(text, /nome_solto \(limitação conhecida\)/);
});
