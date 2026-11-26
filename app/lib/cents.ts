/**
 * Centavos para o texto que a API de reservas aceita ("150,00"). Só valores
 * positivos ou zero: um plano nunca é negativo. Não formata para exibição
 * (isso é de `formatReais`).
 */
export function toApiAmount(cents: bigint): string {
  if (cents < 0n) throw new RangeError("Valor negativo não vai para a API.");
  return `${cents / 100n},${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Centavos → reais (number). Arredonda para o real mais próximo (meio para cima, simétrico no negativo). */
export function toReais(cents: bigint): number {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const reais = (abs + 50n) / 100n;
  const n = Number(reais);
  return neg ? -n : n;
}

/** Reais (number inteiro) → centavos. Lança erro se não for inteiro finito. */
export function fromReais(reais: number): bigint {
  if (!Number.isFinite(reais) || !Number.isInteger(reais)) {
    throw new RangeError("Valor em reais precisa ser um inteiro finito.");
  }
  return BigInt(reais) * 100n;
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function brlAbs(reais: number): string {
  return BRL.format(Math.abs(reais)).replace(/ /g, " ");
}

/** "R$ 4.100" (sem centavos); "−R$ 150" para negativo; "••••" se hidden. */
export function formatReais(reais: number, hidden = false): string {
  if (hidden) return "••••";
  const text = brlAbs(reais);
  return reais < 0 && Math.round(reais) !== 0 ? `−${text}` : text;
}

/** Atalho: formatReais(toReais(cents), hidden). */
export function formatCents(cents: bigint, hidden = false): string {
  return formatReais(toReais(cents), hidden);
}

/** "+R$ 50" / "−R$ 50" / "R$ 0". */
export function formatSignedReais(reais: number, hidden = false): string {
  if (hidden) return "••••";
  const rounded = Math.round(reais);
  if (rounded > 0) return `+${brlAbs(rounded)}`;
  return formatReais(rounded);
}

/**
 * Esconde valores em reais dentro de um texto pronto (frases do motor, como
 * "R$ 2.300 guardados ÷ R$ 2.400 …"). Com hidden=false devolve o texto igual.
 * Cobre sinal (+, −, -) e centavos ("R$ 1.234,56").
 */
export function maskMoney(text: string, hidden: boolean): string {
  if (!hidden) return text;
  return text.replace(/(?:[+−-]\s?)?R\$\s?\d[\d.]*(,\d+)?/g, "••••");
}
