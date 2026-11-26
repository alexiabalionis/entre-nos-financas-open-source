"use client";
import { formatReais, formatSignedReais } from "../lib/cents.ts";
import { cx } from "./shared";
import { useChanged, useTweenNumber } from "./use-motion.ts";

/** Separa sinal, símbolo e número de "−R$ 150" para o símbolo ficar rebaixado (ds-cur). */
function splitMoney(text: string): { sign: string; cur: string; num: string } {
  const m = /^([+−]?)(R\$)\s(.*)$/.exec(text);
  return m ? { sign: m[1], cur: m[2], num: m[3] } : { sign: "", cur: "", num: text };
}

/**
 * Valor em reais que vai até o número novo e marca a mudança (fundo suave).
 * Visual igual ao MoneyText. Não é região viva (quem decide é o componente pai)
 * e, com `hidden`, mostra •••• sem animar nem marcar.
 */
export function AnimatedMoney({
  value,
  signed,
  hidden,
  className,
}: {
  value: number;
  signed?: boolean;
  hidden?: boolean;
  className?: string;
}) {
  const shown = useTweenNumber(value);
  const changed = useChanged(Math.round(value));
  const current = hidden ? value : shown;
  const text = hidden ? "••••" : signed ? formatSignedReais(current) : formatReais(current);
  const { sign, cur, num } = splitMoney(text);
  return (
    <span
      className={cx("ds-money", "ds-amoney", Math.round(current) < 0 && !hidden && "is-neg", className)}
      data-changed={changed && !hidden ? true : undefined}
    >
      {sign}
      {cur ? <span className="ds-cur">{cur}</span> : null}
      {num}
    </span>
  );
}

/**
 * Texto que marca quando muda (ex.: "quitada em nov/27"). Só realça: a frase
 * não desliza nem pisca.
 */
export function ChangedText({ value, className }: { value: string; className?: string }) {
  const changed = useChanged(value);
  return (
    <span className={cx("ds-changed", className)} data-changed={changed ? true : undefined}>
      {value}
    </span>
  );
}
