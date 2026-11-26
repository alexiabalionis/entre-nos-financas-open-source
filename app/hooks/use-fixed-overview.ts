"use client";
/**
 * Visão das contas fixas do mês (`recurrences/overview`). Só busca quando o
 * cartão de Nosso espaço está aberto; durante uma recarga mantém o que já
 * estava na tela, e uma resposta velha nunca sobrescreve a mais nova.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import type { Overview } from "../fixed/overview/overview-types.ts";

export function useFixedOverview(month: string, enabled: boolean) {
  const [held, setHeld] = useState<{ month: string; data: Overview } | null>(
    null,
  );
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++sequence.current;
    setError("");
    try {
      const data = await api<Overview>(`recurrences/overview?month=${month}`);
      if (seq === sequence.current) setHeld({ month, data });
    } catch (e) {
      if (seq === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar as contas fixas.",
        );
    }
  }, [month]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
    return () => {
      sequence.current++;
    };
  }, [enabled, reload]);

  return {
    overview: held && held.month === month ? held.data : null,
    error,
    reload,
  };
}
