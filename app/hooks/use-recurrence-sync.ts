"use client";
import { useEffect, useRef } from "react";
import { api } from "../lib/api.ts";
import { currentMonth } from "../lib/dates.ts";
import { syncWindow } from "../fixed/sync-window.ts";
import { monthCache } from "./use-month-data.ts";

const synced = new Set<string>();
let syncedOwner: string | null = null;

/**
 * Gera as contas fixas que faltam para o mês visto, uma vez por pessoa e mês
 * nesta sessão. Se criou algo, invalida o cache e recarrega a tela. Leitora
 * não grava, e uma falha aqui nunca derruba a tela.
 */
export function useRecurrenceSync(
  month: string,
  owner: string | null,
  reader: boolean,
  reload: () => Promise<void>,
): void {
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  useEffect(() => {
    if (reader || !owner) return;
    if (syncedOwner !== owner) {
      synced.clear();
      syncedOwner = owner;
    }
    const key = `${owner}|${month}`;
    if (synced.has(key)) return;
    synced.add(key);
    api<{ created: number }>(
      "recurrences/sync",
      syncWindow(currentMonth(), month),
    )
      .then((result) => {
        if (result.created <= 0) return;
        monthCache.markStale();
        return reloadRef.current();
      })
      .catch((error: unknown) => {
        synced.delete(key);
        console.debug("recurrences/sync falhou", error);
      });
  }, [month, owner, reader]);
}
