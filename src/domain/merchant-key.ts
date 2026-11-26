// Chave de apelido: a descrição em minúsculas, sem acento, sem as palavras de
// Pix/transferência e sem números. A função merchant_key(text) da migration 042
// repete esta regra; tests-js/merchant-alias.test.ts compara as duas.
export function merchantKey(description: string): string {
  return description
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(pix|ted|doc|transf\w*|enviad[oa]|recebid[oa]|para|cpf|cnpj)\b/g, " ")
    .replace(/[\d.*/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
