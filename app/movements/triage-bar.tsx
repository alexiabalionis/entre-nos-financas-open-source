"use client";
import { Button } from "../ds/button";
import { Icon } from "../ds/icon";

/**
 * Barra de confirmação em lote dentro de Movimentos → A conferir.
 */
export function TriageBar({
  eligibleCount,
  blockedCount,
  reader,
  busy,
  batchState,
  onConfirmAll,
}: {
  eligibleCount: number;
  blockedCount: number;
  reader: boolean;
  busy: boolean;
  batchState?: "idle" | "loading" | "success" | "error";
  onConfirmAll: () => void;
}) {
  if (eligibleCount === 0 && blockedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
          <Icon name="check" size={14} />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-ink">
            {eligibleCount > 0
              ? `${eligibleCount} ${
                  eligibleCount === 1
                    ? "pronto para confirmar"
                    : "prontos para confirmar"
                } com a categoria sugerida`
              : "Itens aguardando compensação no banco"}
          </p>
          {blockedCount > 0 ? (
            <p className="m-0 text-xs text-muted">
              {blockedCount}{" "}
              {blockedCount === 1
                ? "movimento ainda provisório ou alterado no banco."
                : "movimentos ainda provisórios ou alterados no banco."}
            </p>
          ) : null}
        </div>
      </div>

      {eligibleCount > 0 && !reader ? (
        <Button
          variant="primary"
          size="sm"
          icon="check"
          disabled={busy}
          state={batchState}
          busyLabel="Confirmando…"
          successLabel="Confirmados ✓"
          onClick={onConfirmAll}
        >
          Confirmar todos ({eligibleCount})
        </Button>
      ) : null}
    </div>
  );
}
