"use client";
import { useEffect, useRef } from "react";
import { Callout } from "../../ds/callout";

/** Resultado da última ação, no próprio cartão; rola até ele para não ficar fora de vista. */
export function OverviewNotice({
  notice,
  error,
}: {
  notice: string;
  error: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice || error) ref.current?.scrollIntoView({ block: "nearest" });
  }, [notice, error]);
  if (!notice && !error) return null;
  return (
    <div ref={ref} role="status">
      {error ? (
        <p
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : (
        <Callout tone="ok" icon="✓" title="Feito">
          {notice}
        </Callout>
      )}
    </div>
  );
}
