"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Preview } from "./preview-model.ts";

/** Lê a prévia da série a partir de uma data. `reload` pede de novo (versão desatualizada). */
export function useSeriesPreview(recurrenceId: string, from: string) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);

  useEffect(() => {
    let current = true;
    api<Preview>("recurrences/preview", { recurrence_id: recurrenceId, from })
      .then((value) => {
        if (!current) return;
        setPreview(value);
        setError("");
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : "Não foi possível ver a prévia.");
      });
    return () => {
      current = false;
    };
  }, [recurrenceId, from, round]);

  const reload = useCallback(() => {
    setPreview(null);
    setError("");
    setRound((n) => n + 1);
  }, []);

  return { preview, error, loading: preview === null && error === "", reload };
}
