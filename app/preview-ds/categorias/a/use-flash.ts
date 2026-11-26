"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Marca uma chave como "salva" por um instante, para o sucesso aparecer no próprio item. */
export function useFlash(ms = 1400) {
  const [key, setKey] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const flash = useCallback(
    (next: string) => {
      window.clearTimeout(timer.current);
      setKey(next);
      timer.current = window.setTimeout(() => setKey(""), ms);
    },
    [ms],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { flashed: key, flash };
}
