import { formatted } from "../../src/domain/format.ts";
import type { Currency } from "../../src/domain/finance.ts";

/** Valor para a tela: "••••" quando ocultado, "A definir" quando sem valor. */
export function money(
  n: string | null,
  currency: string = "BRL",
  hidden = false,
) {
  return hidden
    ? "••••"
    : n === null
      ? "A definir"
      : formatted(n, currency as Currency);
}
