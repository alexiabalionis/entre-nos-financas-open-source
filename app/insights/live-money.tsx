"use client";
// Valor do Panorama (centavos, com centavos na tela) que vai do número antigo
// ao novo quando a leitura muda, e marca a mudança com o fundo suave do
// design system (.ds-changed). Na primeira pintura já mostra o valor final:
// a animação existe para mostrar que algo mudou, não para enfeitar a entrada.
import { formatted } from "../../src/domain/format.ts";
import { useChanged, useTweenNumber } from "../ds/use-motion.ts";

export function LiveMoney({ cents, hidden }: { cents: bigint; hidden: boolean }) {
  const target = Number(cents);
  const shown = useTweenNumber(target, 520);
  const changed = useChanged(cents);
  if (hidden) return <>••••</>;
  return (
    <span className="ds-changed" data-changed={changed ? true : undefined}>
      {formatted(String(Math.round(shown)), "BRL")}
    </span>
  );
}

/** Percentual inteiro que desliza até o novo e marca a mudança, como LiveMoney. */
export function LivePercent({ value }: { value: number }) {
  const shown = useTweenNumber(value, 520);
  const changed = useChanged(value);
  return (
    <span className="ds-changed" data-changed={changed ? true : undefined}>
      {Math.round(shown)}%
    </span>
  );
}
