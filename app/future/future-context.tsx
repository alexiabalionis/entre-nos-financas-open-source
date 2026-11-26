"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  applyScenario,
  compareFuture,
  describeScenario,
  projectFuture,
  type DiffItem,
  type FutureInput,
  type FutureResult,
  type Scenario,
} from "../../src/domain/future-months.ts";
import { changeCount, isDirty, type ListName, type Months } from "./future-state.ts";
import type { FutureStore } from "./use-future.ts";

export type FutureView = {
  status: "loading" | "ready" | "error";
  error: string;
  hidden: boolean;
  reader: boolean;
  months: number;
  selected: number;
  /** Dados do plano salvo (sem rascunho); null enquanto carrega. */
  input: FutureInput | null;
  /** Plano salvo: projectFuture(input). */
  base: FutureResult | null;
  /** Rascunho: projectFuture(applyScenario(input, scenario)); é o próprio `base` se nada mudou. */
  draft: FutureResult | null;
  draftInput: FutureInput | null;
  scenario: Scenario;
  dirty: boolean;
  changes: number;
  describe: string[];
  diff: DiffItem[];
  select(i: number): void;
  setMonths(m: Months): void;
  patch(p: Partial<Scenario>): void;
  replace(s: Scenario): void;
  remove(list: ListName, key: string): void;
  discard(): void;
  /** Há aporte ou pausa para gravar e a pessoa pode gravar. */
  canSave: boolean;
  /** Devolve true quando gravou tudo (false: nada a gravar ou erro em `error`). */
  save(): Promise<boolean>;
  /** Relê os dados do servidor (ex.: depois de gravar um objetivo por outro caminho). */
  reload(): Promise<void>;
  saving: boolean;
};

const Context = createContext<FutureView | null>(null);

/**
 * Entrega o Futuro às peças: calcula o plano salvo e o rascunho no navegador
 * (com memo) e expõe as ações. Não busca nada: isso é de useFuture.
 */
export function FutureProvider({
  value,
  hidden,
  reader,
  children,
}: {
  value: FutureStore;
  hidden: boolean;
  reader: boolean;
  children: ReactNode;
}) {
  const { state, dispatch } = value;
  const computed = useMemo(() => {
    if (!state.input) return null;
    const input: FutureInput = { ...state.input, months: Math.min(state.months, state.input.months) };
    const base = projectFuture(input);
    const dirty = isDirty(state.scenario);
    const draftInput = dirty ? applyScenario(input, state.scenario) : input;
    const draft = dirty ? projectFuture(draftInput) : base;
    const names: Record<string, string> = {};
    for (const g of input.goals) names[g.id] = g.name;
    for (const g of state.scenario.newGoals ?? []) names[g.id] = g.name;
    return {
      base,
      draft,
      draftInput,
      describe: describeScenario(input, state.scenario),
      diff: compareFuture(base, draft, input.months, names),
    };
  }, [state.input, state.scenario, state.months]);

  // Aporte para um objetivo que só existe no rascunho (newGoals) não vai pela
  // gravação de aportes: quem cria o objetivo é a pergunta do Simular.
  const draftOnly = new Set((state.scenario.newGoals ?? []).map((g) => g.id));
  const canSave =
    !reader &&
    (state.scenario.contributions ?? []).filter((c) => !draftOnly.has(c.goalId)).length +
      (state.scenario.pauses?.length ?? 0) >
      0;

  const view = useMemo<FutureView>(
    () => ({
      status: value.status,
      error: value.error,
      hidden,
      reader,
      months: state.months,
      selected: state.selected,
      input: state.input,
      base: computed?.base ?? null,
      draft: computed?.draft ?? null,
      draftInput: computed?.draftInput ?? null,
      scenario: state.scenario,
      dirty: isDirty(state.scenario),
      changes: changeCount(state.scenario),
      describe: computed?.describe ?? [],
      diff: computed?.diff ?? [],
      select: (index) => dispatch({ type: "select", index }),
      setMonths: (months) => dispatch({ type: "setMonths", months }),
      patch: (patch) => dispatch({ type: "patch", patch }),
      replace: (scenario) => dispatch({ type: "replace", scenario }),
      remove: (list, key) => dispatch({ type: "remove", list, key }),
      discard: () => dispatch({ type: "discard" }),
      canSave,
      save: canSave ? value.save : async () => false,
      saving: value.saving,
      reload: value.reload,
    }),
    [value.status, value.error, value.save, value.saving, value.reload, hidden, reader, state, computed, canSave, dispatch],
  );
  return <Context.Provider value={view}>{children}</Context.Provider>;
}

export function useFutureContext(): FutureView {
  const view = useContext(Context);
  if (!view) throw new Error("useFutureContext precisa estar dentro de um FutureProvider.");
  return view;
}
