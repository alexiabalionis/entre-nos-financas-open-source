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
        <p className="alert alert-soft alert-error" role="alert">
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
