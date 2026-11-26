"use client";
/**
 * Estado de uma ação de gravação: ocupado, erro e aviso de sucesso. Cada tela
 * (e cada login/formulário) tem o seu, no lugar do work() único que vivia em
 * family.tsx. Mesma regra de antes: ignora um segundo disparo enquanto ocupado,
 * limpa erro e aviso ao começar, e mostra o aviso ao terminar.
 */
import { useCallback, useRef, useState } from "react";

export type Action = ReturnType<typeof useAction>;

export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const running = useRef(false);
  const work = useCallback(
    async (action: () => Promise<void>, message = "Salvo para vocês dois.") => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError("");
      setNotice("");
      try {
        await action();
        setNotice(message);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Não foi possível salvar.");
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, notice, work, setError, setNotice };
}
