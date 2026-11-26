"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { FutureWire } from "../../src/server/future-plan.ts";
import { api, ApiError } from "../lib/api.ts";
import { toApiAmount } from "../lib/cents.ts";
import { decodeFutureInput } from "./decode.ts";
import {
  futureReducer,
  initialState,
  planWrites,
  type Months,
} from "./future-state.ts";

/** Sempre se busca o horizonte máximo: trocar o recorte na tela não refaz a busca. */
const FETCH_MONTHS = 36;
const UNAVAILABLE = "O futuro ainda não está disponível.";

/**
 * Único lugar que busca dados do Futuro. Guarda o plano salvo (servidor) e o
 * rascunho (simulação local, que nunca grava) e sabe gravar os aportes do
 * rascunho como plano. Não calcula nada: quem recalcula é o FutureProvider.
 */
export function useFuture(opts: { months?: Months } = {}) {
  const [state, dispatch] = useReducer(futureReducer, opts.months ?? 24, initialState);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    try {
      const wire = await api<FutureWire>(`family/future?months=${FETCH_MONTHS}`, undefined, mine.signal);
      if (mine.signal.aborted) return;
      dispatch({ type: "loaded", input: decodeFutureInput(wire.input) });
      setStatus("ready");
      setError("");
    } catch (e) {
      if (mine.signal.aborted) return;
      setStatus("error");
      setError(e instanceof ApiError && e.status === 404 ? UNAVAILABLE : e instanceof Error ? e.message : UNAVAILABLE);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  /** Grava aportes e pausas do rascunho (reserves/plan-range), recarrega e descarta o rascunho. Devolve se gravou tudo. */
  const save = useCallback(async () => {
    if (!state.input || saving) return false;
    const writes = planWrites(state.input, state.scenario);
    if (!writes.length) return false;
    setSaving(true);
    setError("");
    let failed = "";
    try {
      // Em ordem: o plano que devolve o valor de antes só vale depois do aporte.
      for (const w of writes)
        await api("reserves/plan-range", {
          goal_id: w.goal_id,
          from_month: w.from_month,
          months: w.months,
          planned: toApiAmount(w.cents),
        });
      dispatch({ type: "discard" });
    } catch (e) {
      failed = e instanceof Error ? e.message : "Não foi possível salvar o plano.";
    } finally {
      // Mesmo com erro no meio, o que já foi gravado precisa aparecer.
      await load();
      if (failed) setError(failed);
      setSaving(false);
    }
    // true só quando todos os aportes foram gravados.
    return !failed;
  }, [state.input, state.scenario, saving, load]);

  return { state, dispatch, status, error, saving, reload: load, save };
}

export type FutureStore = ReturnType<typeof useFuture>;
