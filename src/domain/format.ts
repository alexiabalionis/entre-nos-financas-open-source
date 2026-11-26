import type { Currency } from "./finance.ts";
export function plainMoney(value: string): string {
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return (
    (n < 0n ? "-" : "") +
    (abs / 100n).toString() +
    "," +
    (abs % 100n).toString().padStart(2, "0")
  );
}
export function formatted(value: string, currency: Currency): string {
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return `${{ BRL: "R$", USD: "US$", EUR: "€" }[currency]} ${n < 0n ? "-" : ""}${(abs / 100n).toLocaleString("pt-BR")},${(abs % 100n).toString().padStart(2, "0")}`;
}
export function brDate(day: string): string {
  return day.slice(0, 10).split("-").reverse().join("/");
}
export function privateText(value: string, hidden: boolean): string {
  return hidden ? value.replace(/[-+]?\d[\d.]*,\d{2}/g, "••••") : value;
}
/** Nome de estabelecimento legível: "IFOOD *REST" vira "Ifood *Rest". */
export function readable(merchant: string): string {
  return merchant
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/**
 * Tira sequências longas de dígitos (CPF, CNPJ, cartão, conta) de um texto que
 * vai ao provedor de IA ou fica guardado. Não remove nomes nem emails.
 */
export function maskLongNumbers(text: string): string {
  return text.replace(/\d[\d./-]{5,}\d/g, "…").replace(/\s+/g, " ").trim();
}
