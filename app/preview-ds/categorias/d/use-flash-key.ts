import { useCallback, useEffect, useRef, useState } from "react";

/** Guarda por um instante a chave do item recém-salvo, para ele mostrar "Salvo" no próprio lugar. */
export function useFlashKey(ms = 1400): [string | null, (key: string) => void] {
  const [key, setKey] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(
    (next: string) => {
      setKey(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setKey(null), ms);
    },
    [ms],
  );
  return [key, flash];
}
