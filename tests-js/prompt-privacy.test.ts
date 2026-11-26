import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForProvider, sanitizePayloadText, sanitizeText } from "../src/domain/prompt-privacy.ts";

test("sanitizeText: documentos, contatos e nome em Pix saem; valores e datas ficam", () => {
  assert.equal(sanitizeText("PIX ENVIADO MARIA DA SILVA 123.456.789-00"), "PIX ENVIADO … …");
  assert.equal(sanitizeText("Pix recebido João Souza em 10/11"), "Pix recebido … em 10/11");
  assert.equal(sanitizeText("Pix de agosto e o Pix enviado"), "Pix de agosto e o Pix enviado");
  assert.equal(sanitizeText("Falar com ana@exemplo.com ou (11) 98765-4321"), "Falar com [email] ou [telefone]");
  assert.equal(sanitizeText("CNPJ 12.345.678/0001-90, cartão 4111 1111 1111 1111"), "CNPJ …, cartão …");
  assert.equal(sanitizeText("Gastou R$ 1.234.567,89 em 2026-10-01"), "Gastou R$ 1.234.567,89 em 2026-10-01");
});

test("sanitizeForProvider: percorre fatos, notas, memória e histórico; números estruturais intactos", () => {
  const out = sanitizeForProvider({
    history: [{ role: "user", text: "o Pix para Carlos Lima foi de R$ 200,00" }],
    nota: "Conta 12345678 da Bia",
    amount_cents: "123456789",
    data: "2026-11-20",
    linhas: [{ nome: "TED JOSE PEREIRA", valor_cents: "-10000" }],
  });
  assert.deepEqual(out, {
    history: [{ role: "user", text: "o Pix para … foi de R$ 200,00" }],
    nota: "Conta … da Bia",
    amount_cents: "123456789",
    data: "2026-11-20",
    linhas: [{ nome: "TED …", valor_cents: "-10000" }],
  });
  assert.equal(sanitizePayloadText("texto 98765432100 puro"), "texto … puro");
});
