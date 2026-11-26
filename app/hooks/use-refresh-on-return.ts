"use client";
/**
 * Recarrega os dados da tela quando a pessoa volta para a aba/janela
 * (`visibilitychange` → visible, no máximo 1x a cada 30s) e quando os bancos
 * foram lidos de novo (`family-banks-updated`, sempre recarrega). Não chama o
 * Pluggy: só pede ao `reload` da tela para reler a API do app.
 */
import { useEffect, useRef } from "react";

export const BANKS_UPDATED_EVENT = "family-banks-updated";
const VISIBILITY_THROTTLE_MS = 30_000;

export function useRefreshOnReturn(
  reload: () => void | Promise<unknown>,
  enabled: boolean,
): void {
  const reloadRef = useRef(reload);
  const lastVisibilityReload = useRef(Date.now());

  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      void Promise.resolve()
        .then(() => reloadRef.current())
        .catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastVisibilityReload.current < VISIBILITY_THROTTLE_MS) return;
      lastVisibilityReload.current = now;
      run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(BANKS_UPDATED_EVENT, run);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(BANKS_UPDATED_EVENT, run);
    };
  }, [enabled]);
}
