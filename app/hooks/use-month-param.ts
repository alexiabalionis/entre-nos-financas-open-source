"use client";
/**
 * Mês selecionado, guardado em `?month=YYYY-MM` (a URL antiga já era assim).
 * Trocar de mês usa replace: passar de mês em mês não enche o histórico.
 * Sem parâmetro válido vale o mês atual.
 */
import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MONTH_PATTERN, currentMonth } from "../lib/dates.ts";

export function useMonthParam() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const raw = params.get("month");
  const hasParam = !!raw && MONTH_PATTERN.test(raw);
  const month = hasParam ? raw : currentMonth();
  const setMonth = useCallback(
    (next: string) => {
      const query = new URLSearchParams(params.toString());
      query.set("month", next);
      router.replace(pathname + "?" + query.toString(), { scroll: false });
    },
    [params, pathname, router],
  );
  return { month, hasParam, setMonth };
}
