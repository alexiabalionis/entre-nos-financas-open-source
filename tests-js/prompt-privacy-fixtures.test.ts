import { test } from "node:test";
import assert from "node:assert/strict";
import { auditPayload, sanitizeForProvider, sanitizeText } from "../src/domain/prompt-privacy.ts";

const PERDA_UTIL = [
  "Parcela 3/10",
  "em 12x de R$ 150,00",
  "10/12",
  "2026-11-20",
  "20/11/2026",
  "nov/2026",
  "R$ 1.234.567,89",
  "-R$ 800,00",
  "15%",
  "c0",
  "m12",
  "p3",
  "a1",
  "g0",
  "MARIA BONITA RESTAURANTE",
  "CASAS BAHIA",
  "Drogaria São Paulo",
  "PIX QR CODE MERCADO LIVRE",
  "Pix Delivery Ifood",
  "Combinamos limitar Delivery a R$ 600,00 por mês a partir de 01/12/2026",
];

test("perda útil: textos financeiros ficam idênticos", () => {
  for (const t of PERDA_UTIL) {
    assert.equal(sanitizeText(t), t, t);
    assert.equal(sanitizeForProvider(t), t, t);
  }
});

test("perda útil: JSON de ferramenta, centavos e refs ficam idênticos", () => {
  const call = { tool: { name: "historico_categoria", categoria: "c0", comparar_com: "m0" } };
  assert.deepEqual(sanitizeForProvider(call), call);
  const fato = { amount_cents: "1234567", valor_cents: 1234567, saldo_cents: "-1234567", mes: "2026-11" };
  assert.deepEqual(sanitizeForProvider(fato), fato);
});

const VAZAMENTO: [string, string][] = [
  ["PIX ENVIADO MARIA DA SILVA", "MARIA"],
  ["Pix enviado Maria da Silva", "Maria"],
  ["TED JOSE PEREIRA", "JOSE"],
  ["Pix para Carlos Lima", "Carlos"],
  ["Pix recebido João Souza", "João"],
  ["CPF 123.456.789-00", "456.789"],
  ["cpf 12345678900", "12345678900"],
  ["CNPJ 12.345.678/0001-90", "0001-90"],
  ["cnpj 12345678000190", "12345678000190"],
  ["ligar (11) 98765-4321", "98765"],
  ["ligar 11987654321", "11987654321"],
  ["ana@exemplo.com", "ana@"],
  ["chave 123e4567-e89b-12d3-a456-426614174000", "426614174000"],
  ["cartão 4111 1111 1111 1111", "4111 1111"],
];

test("vazamento: nome e documento não saem", () => {
  for (const [texto, segredo] of VAZAMENTO) {
    assert.ok(!sanitizeText(texto).includes(segredo), `${texto} -> ${sanitizeText(texto)}`);
  }
});

// Limitação conhecida: nomes soltos não são detectáveis sem heurística frágil.
// Este teste mede o vazamento atual; se algum dia passar a mascarar, atualize-o.
test("limitação conhecida: nomes soltos em texto livre ainda vazam", () => {
  for (const [texto, nome] of [
    ["a Bia pagou", "Bia"],
    ["Conta do João", "João"],
    ["pix enviado maria da silva", "maria"],
    ["Pix para joão souza", "joão"],
  ]) {
    assert.ok(sanitizeText(texto).includes(nome), texto);
  }
});

test("auditPayload: classifica campos, conta detecções e nunca devolve o texto", () => {
  const payload = {
    valor_cents: 1234,
    data: "2026-11-20",
    ref: "c0",
    texto: "PIX ENVIADO MARIA DA SILVA 123.456.789-00 ana@exemplo.com (11) 98765-4321",
    itens: [{ nota: "CNPJ 12.345.678/0001-90 cartão 4111 1111 1111 1111 conta 12345678" }],
  };
  const audit = auditPayload(payload);
  const tipos = Object.fromEntries(audit.campos.map((c) => [c.caminho, c.tipo]));
  assert.equal(tipos["$.valor_cents"], "numero");
  assert.equal(tipos["$.data"], "estrutural");
  assert.equal(tipos["$.ref"], "estrutural");
  assert.equal(tipos["$.texto"], "texto_livre");
  assert.equal(tipos["$.itens[0].nota"], "texto_livre");
  const det = (caminho: string, detector: string) =>
    audit.deteccoes.find((d) => d.caminho === caminho && d.detector === detector)?.contagem;
  assert.equal(det("$.texto", "nome_apos_transferencia"), 1);
  assert.equal(det("$.texto", "cpf"), 1);
  assert.equal(det("$.texto", "email"), 1);
  assert.equal(det("$.texto", "telefone"), 1);
  assert.equal(det("$.itens[0].nota", "cnpj"), 1);
  assert.equal(det("$.itens[0].nota", "cartao"), 1);
  assert.equal(det("$.itens[0].nota", "digitos_longos"), 1);
  const dump = JSON.stringify(audit);
  for (const segredo of ["MARIA", "123.456.789", "ana@", "98765", "12.345.678", "4111", "12345678", "1234", "2026-11-20"])
    assert.ok(!dump.includes(segredo), segredo);
});
