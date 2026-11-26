"use client";
/**
 * Hook de navegação de mês. Uma responsabilidade: qual mês e qual filtro
 * estão selecionados na tela. Estado PURO de navegação/filtro — não busca
 * dados nem conhece a API; quem precisa dos lançamentos recebe `month` por
 * argumento. Porta a parte de navegação de mês de family.tsx.
 */
import { useCallback, useState } from "react";
import { currentMonth, moveMonth as shiftMonth } from "../lib/dates.ts";

export type MonthFilter = "all" | "open" | "done";

export type UseMonth = {
  /** Mês selecionado no formato 'YYYY-MM'. */
  month: string;
  filter: MonthFilter;
  setMonth: (m: string) => void;
  /** Avança (n>0) ou volta (n<0) n meses, preservando o ano corretamente. */
  moveMonth: (n: number) => void;
  setFilter: (f: MonthFilter) => void;
};

export function useMonth(): UseMonth {
  const [month, setMonth] = useState(currentMonth);
  const [filter, setFilter] = useState<MonthFilter>("all");

  const moveMonth = useCallback((n: number) => {
    setMonth((prev) => shiftMonth(prev, n));
  }, []);

  return { month, filter, setMonth, moveMonth, setFilter };
}
