import { useCallback, useEffect, useRef, useState } from "react";

/** Liga um "sucesso" por alguns instantes (o Button mostra o estado success) e depois roda `after`. */
export function useFlash(ms = 1400): [boolean, (after?: () => void) => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(
    (after?: () => void) => {
      setOn(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setOn(false);
        after?.();
      }, ms);
    },
    [ms],
  );
  return [on, flash];
}
