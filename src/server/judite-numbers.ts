// Limite de números no text da resposta (SPEC-JUDITE-PROFUNDIDADE, Fase 3a):
// o detalhe numérico vai para `contas`. O servidor confere só o total.
import { moneyCount } from "../domain/money-check.ts";

const PERCENT = /\d+(?:[.,]\d+)?\s?%/g;

/** JUDITE_FORMAT=classic: sem limite de números e sem `contas`. */
export const classicFormat = () => process.env.JUDITE_FORMAT === "classic";

// Desligado por padrão (23/11/2026): o teto de números fez o modelo esvaziar as respostas.
// JUDITE_NUMBER_LIMIT=1 liga de novo (5 no diagnóstico, 2 nas outras) para comparar.
export const numberLimit = (diagnostic: boolean) =>
  process.env.JUDITE_NUMBER_LIMIT === "1" ? (diagnostic ? 5 : 2) : Number.POSITIVE_INFINITY;

export const countNumbers = (text: string) =>
  moneyCount(text) + (text.match(PERCENT)?.length ?? 0);

/** Aviso da única reescrita; null quando o text cabe no limite. */
export function numbersRewrite(
  text: string,
  diagnostic: boolean,
): { count: number; hint: string } | null {
  const limit = numberLimit(diagnostic);
  const count = countNumbers(text);
  if (count <= limit) return null;
  return {
    count,
    hint: `O text tem ${count} valores ou percentuais e o limite é ${limit}. Reescreva com no máximo ${limit} no text, só os que sustentam a decisão, e passe o detalhe numérico para o campo "contas" (linhas curtas, até 2000 caracteres), usando só valores de tool_results ou dos fatos. Resposta anterior: ${text}`,
  };
}
