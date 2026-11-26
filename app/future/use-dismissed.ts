"use client";
// Sugestões escondidas com "agora não", por família (as duas pessoas veem
// igual). A lista vem de GET future/dismissed; esconder grava na hora e some da
// tela sem esperar a volta. Se a leitura falhar, nada fica escondido: o pior
// caso é ver uma sugestão a mais, nunca perder uma.
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { Decision } from "../../src/domain/future-months.ts";
import { stillDismissed, type Dismissed } from "./simulator-verdict.ts";

export function useDismissed(canWrite: boolean) {
  const [list, setList] = useState<Dismissed[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ id: string; metric: string | null }[]>("future/dismissed", undefined, controller.signal)
      .then((rows) => setList(rows.map((r) => ({ id: r.id, metric: r.metric === null ? null : BigInt(r.metric) }))))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const hidden = useCallback(
    (d: Decision) => stillDismissed(d.metric, list.find((x) => x.id === d.id)),
    [list],
  );
  const dismiss = useCallback(
    (d: Decision) => {
      if (!canWrite) return;
      const metric = d.metric ?? null;
      setList((l) => [...l.filter((x) => x.id !== d.id), { id: d.id, metric }]);
      void api("future/dismiss", { id: d.id, metric: metric === null ? null : metric.toString() }).catch(() => {});
    },
    [canWrite],
  );
  const restore = useCallback(() => {
    if (!canWrite) return;
    setList([]);
    void api("future/dismissed/restore", {}).catch(() => {});
  }, [canWrite]);
  return { hidden, dismiss, restore };
}
