"use client";
// Referência de gasto da categoria escolhida (GET budgets/reference). Busca
// quando a categoria ou o mês mudam e cancela a busca anterior. Só leitura.
import { useEffect, useState } from "react";
import type { BudgetReference } from "../../src/server/budget-reference.ts";
import { api } from "../lib/api.ts";

type State = { key: string; ref: BudgetReference | null };

export function useBudgetReference(categoryId: string, month: string) {
  const key = `${categoryId}|${month}`;
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!categoryId) return;
    const controller = new AbortController();
    api<BudgetReference>(
      `budgets/reference?category=${encodeURIComponent(categoryId)}&month=${encodeURIComponent(month)}`,
      undefined,
      controller.signal,
    )
      .then((ref) => setState({ key, ref }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ key, ref: null });
      });
    return () => controller.abort();
  }, [categoryId, month, key]);
  // Resposta de outra categoria não vale: enquanto busca, loading.
  const ready = state !== null && state.key === key;
  return { loading: !ready, ref: ready ? state.ref : null };
}
