"use client";
import type { HTMLAttributes } from "react";
import { cx } from "./shared";

/** Moedas suportadas. O glifo é rebaixado (ds-cur) opcionalmente. */
type Currency = "BRL" | "USD" | "EUR";

type MoneyTextProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  /** Número em reais/dólares/euros. Sempre number: nada de string pré-formatada
   *  (a engenharia reversa por regex pintava cor errada em "R$-10"/"(R$ 10)"). */
  value: number;
  currency?: Currency;
  /** Mostra "+" quando positivo. */
  sign?: boolean;
  /** Força a classe is-pos independente do valor. */
  pos?: boolean;
  /** Rebaixa o símbolo da moeda num span.ds-cur (default true). */
  demoteCurrency?: boolean;
};

/**
 * Valor monetário tabular do design system. Não escolhe cor crua: o tom
 * (vermelho/verde) vem das classes is-neg/is-pos do family.css. Formata o
 * number em pt-BR via Intl e usa formatToParts para separar o símbolo da moeda
 * do número — assim o sinal/tom vêm do próprio value, nunca de regex.
 */
export function MoneyText({
  value,
  currency = "BRL",
  sign,
  pos,
  demoteCurrency = true,
  className,
  ...rest
}: MoneyTextProps) {
  const isNeg = value < 0;
  const fmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
  const parts = fmt.formatToParts(value);
  const cur = parts.find((p) => p.type === "currency")?.value ?? "";
  const number = parts
    .filter((p) => p.type !== "currency")
    .map((p) => p.value)
    .join("")
    .trim();
  // Prefixo "+" vem antes do número e fora do símbolo da moeda.
  const prefix = sign && value > 0 ? "+" : "";
  const classes = cx("ds-money", isNeg && "is-neg", pos && "is-pos", className);
  return (
    <span {...rest} className={classes}>
      {demoteCurrency && cur ? <span className="ds-cur">{cur}</span> : null}
      {demoteCurrency || !cur ? `${prefix}${number}` : `${cur} ${prefix}${number}`}
    </span>
  );
}
