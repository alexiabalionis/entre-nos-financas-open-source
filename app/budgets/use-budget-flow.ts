"use client";
import { useState } from "react";
import { useAction } from "../hooks/use-action.ts";
import { monthCache } from "../hooks/use-month-data.ts";
import { api } from "../lib/api.ts";
import {
  ceilingInput,
  parseCeiling,
  removePayload,
  removedNotice,
  savePayload,
  savedNotice,
  type BudgetDraft,
} from "./budget-form-model.ts";
import type { BudgetCardModel, Money } from "./budget-view-model.ts";

type View = "detail" | "form" | "remove" | null;
type Category = { id: string; name: string };

/**
 * Fluxo dos diálogos de teto: detalhe, formulário (com rascunho que sobrevive
 * à confirmação de "tirar") e gravação. Dono do estado do bloco inteiro.
 */
export function useBudgetFlow(input: {
  month: string;
  currency: string;
  cards: BudgetCardModel[];
  free: Category[];
  categories: Category[];
  fmt: Money;
  reload: () => Promise<void>;
}) {
  const { month, currency, cards, free, categories, fmt, reload } = input;
  const action = useAction();
  const [view, setView] = useState<View>(null);
  const [detailId, setDetailId] = useState("");
  const [draft, setDraft] = useState<BudgetDraft>({
    categoryId: "",
    from: month,
    value: "",
  });
  const [showError, setShowError] = useState(false);

  const card = cards.find((c) => c.id === draft.categoryId) ?? null;
  const name = categories.find((c) => c.id === draft.categoryId)?.name ?? "";

  function openDetail(id: string) {
    action.setError("");
    setDetailId(id);
    setView("detail");
  }
  function openForm(id: string | null, suggested?: bigint) {
    const target = id ?? free[0]?.id;
    if (!target) return;
    const existing = cards.find((c) => c.id === target);
    const start = suggested ?? existing?.ceiling;
    action.setError("");
    setShowError(false);
    setDraft({
      categoryId: target,
      from: month,
      value: start !== undefined ? ceilingInput(start) : "",
    });
    setView("form");
  }
  function edit(patch: Partial<BudgetDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    if (patch.value !== undefined) setShowError(false);
  }
  const close = () => setView(null);

  function save() {
    const payload = savePayload(draft, currency);
    const cents = parseCeiling(draft.value);
    if (!payload || cents === null) return setShowError(true);
    void action.work(
      async () => {
        await api("budgets", payload);
        monthCache.markStale();
        await reload();
        close();
      },
      savedNotice(name, fmt(cents), draft.from, month),
    );
  }
  function remove() {
    void action.work(
      async () => {
        await api("budgets", removePayload(draft, currency));
        monthCache.markStale();
        await reload();
        close();
      },
      removedNotice(name, draft.from, month),
    );
  }

  return {
    action,
    view,
    detailId,
    draft,
    showError,
    card,
    name,
    openDetail,
    openForm,
    openRemove: () => {
      action.setError("");
      setView("remove");
    },
    backToForm: () => {
      action.setError("");
      setView("form");
    },
    edit,
    close,
    save,
    remove,
  };
}
