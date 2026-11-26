"use client";
/**
 * Hook de dados do mês. Uma responsabilidade: buscar os DADOS do mês da API
 * (`family/month` e `family/projection`) para o mês/moeda atuais, reaproveitando
 * o último resultado ao trocar de página (ver hooks/month-cache.ts).
 *
 * `owner` é o e-mail da pessoa logada (null = deslogada). Os dados só são
 * entregues e guardados para o mesmo dono; sem dono nada é buscado nem exibido.
 * Race guard mantido de family.tsx: um contador de sequência por instância
 * descarta a resposta velha e o cleanup cancela a busca em voo.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { createMonthCache } from "./month-cache.ts";
import type { readState } from "../../src/server/state.ts";
import type { readRoutine } from "../../src/server/routine.ts";
import type { readCards } from "../../src/server/cards.ts";
import type { ProjectionMonthWire } from "../../src/server/projection.ts";
import type { Currency } from "../../src/domain/finance.ts";

export type Data = {
  cards: Awaited<ReturnType<typeof readCards>>;
  state: Awaited<ReturnType<typeof readState>>;
  routine: Awaited<ReturnType<typeof readRoutine>>;
};

/** Slot único do app. `clear()` na troca de pessoa; `markStale()` após escrita. */
export const monthCache = createMonthCache<Data, ProjectionMonthWire>();

export type UseMonthData = {
  data: Data | null;
  projection: ProjectionMonthWire | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
};

type Held = {
  owner: string;
  data: Data;
  projection: ProjectionMonthWire | null;
};

export function useMonthData(
  month: string,
  currency: Currency,
  owner: string | null,
): UseMonthData {
  const [held, setHeld] = useState<Held | null>(() => {
    const snap = owner ? monthCache.read(owner, month, currency) : null;
    return owner && snap
      ? { owner, data: snap.data, projection: snap.projection }
      : null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSequence.current;
    if (!owner) return;
    const ticket = monthCache.begin();
    setLoading(true);
    setError("");
    let monthError: string | null = null;
    try {
      const query = new URLSearchParams({ month, currency });
      const [monthResult, projResult] = await Promise.allSettled([
        api<Data>("family/month?" + query),
        api<ProjectionMonthWire>("family/projection?" + query),
      ]);
      const next = monthResult.status === "fulfilled" ? monthResult.value : null;
      if (monthResult.status === "rejected")
        monthError =
          monthResult.reason instanceof Error
            ? monthResult.reason.message
            : "Falha ao carregar o mês.";
      // A projeção é opcional: falha não invalida o mês.
      const proj = projResult.status === "fulfilled" ? projResult.value : null;
      if (next) monthCache.commit(ticket, owner, month, currency, next, proj);
      if (seq === requestSequence.current) {
        // Sempre aplica a projeção (null se falhou): nunca mostra a de outro mês.
        setHeld((prior) => {
          const data = next ?? (prior?.owner === owner ? prior.data : null);
          return data ? { owner, data, projection: proj } : null;
        });
      }
    } finally {
      if (seq === requestSequence.current) {
        setLoading(false);
        setError(monthError ?? "");
      }
    }
  }, [month, currency, owner]);

  useEffect(() => {
    if (!owner) {
      setHeld(null);
      setLoading(false);
      return;
    }
    const snap = monthCache.read(owner, month, currency);
    if (snap) {
      setHeld({ owner, data: snap.data, projection: snap.projection });
      // Dados em cache e válidos: troca de página não refaz a requisição.
      if (!snap.stale) {
        setLoading(false);
        return;
      }
    }
    void reload();
    return () => {
      requestSequence.current++;
    };
  }, [reload, owner, month, currency]);

  const mine = held && held.owner === owner ? held : null;
  return {
    data: mine?.data ?? null,
    projection: mine?.projection ?? null,
    loading,
    error,
    reload,
  };
}

/** Um item do planejamento do mês (linha de `routine.items`). */
export type MonthItem = Data["routine"]["items"][number];
