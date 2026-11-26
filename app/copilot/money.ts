// Formatação de dinheiro da tela Copiloto, respeitando o "ocultar valores".
import { formatted } from "../../src/domain/format.ts";

export type Money = (value: bigint) => string;

export function moneyOf(hidden: boolean): Money {
  return (value) => (hidden ? "••••" : formatted(value.toString(), "BRL"));
}

// Com sinal explícito (+/−) para o histórico.
export function signedMoney(money: Money, value: bigint): string {
  const abs = value < 0n ? -value : value;
  return (value < 0n ? "−" : "+") + money(abs);
}

// Centavos -> texto no formato que a API aceita ("150,00").
export function apiAmount(cents: bigint): string {
  return `${cents / 100n},${(cents % 100n).toString().padStart(2, "0")}`;
}

// Centavos -> texto pro campo de um formulário, com milhar ("1.500,00") —
// o mesmo formato que parseAmount aceita de volta.
export function amountInput(cents: bigint): string {
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole},${(cents % 100n).toString().padStart(2, "0")}`;
}

// Cores fixas por posição do objetivo, matizes alternados (tokens do tema).
export const GOAL_COLORS = [
  "var(--family-cat-4)",
  "var(--family-cat-6)",
  "var(--family-cat-2)",
  "var(--family-cat-8)",
];
