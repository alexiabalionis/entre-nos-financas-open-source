"use client";
import { Segmented } from "../ds/index.ts";
import { useFutureContext } from "./future-context.tsx";
import type { Months } from "./future-state.ts";

const OPTIONS: { value: Months; label: string }[] = [
  { value: 3, label: "3 meses" },
  { value: 6, label: "6 meses" },
  { value: 12, label: "1 ano" },
  { value: 24, label: "2 anos" },
  { value: 36, label: "3 anos" },
];

/**
 * Escolhe quanto do futuro mostrar (3 meses a 3 anos). Só liga o Segmented ao
 * horizonte do contexto; trocar não refaz a busca, só recorta a projeção.
 */
export function HorizonSwitch() {
  const f = useFutureContext();
  return (
    <Segmented
      label="Quanto do futuro mostrar"
      value={f.months as Months}
      options={OPTIONS}
      onChange={f.setMonths}
      size="sm"
    />
  );
}
