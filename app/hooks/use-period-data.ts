"use client";
/**
 * Dados do mês escolhido na URL para as páginas que dependem dele (Mês,
 * Movimentos, Panorama, Nosso espaço): mês, dados prontos, recarga e atualização
 * ao voltar para a aba. `data` só vem preenchido quando é do mês e da moeda
 * pedidos (a regra periodReady de family.tsx).
 */
import { useSession } from "../session/session-context";
import { useMonthData } from "./use-month-data.ts";
import { useMonthParam } from "./use-month-param.ts";
import { useRefreshOnReturn } from "./use-refresh-on-return.ts";
import { useRecurrenceSync } from "./use-recurrence-sync.ts";
import type { Currency } from "../../src/domain/finance.ts";

const currency: Currency = "BRL";

export function usePeriodData() {
  const { user, reader } = useSession();
  const { month, setMonth } = useMonthParam();
  const { data, projection, loading, error, reload } = useMonthData(
    month,
    currency,
    user.email,
  );
  const ready =
    !!data && data.state.month === month + "-01" && data.state.currency === currency;
  useRefreshOnReturn(reload, true);
  useRecurrenceSync(month, user.email, reader, reload);
  return {
    month,
    setMonth,
    currency,
    data: ready ? data : null,
    projection,
    ready,
    loading,
    error,
    reload,
  };
}
