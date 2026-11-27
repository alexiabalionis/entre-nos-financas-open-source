"use client";
import { Button, type ButtonState } from "../ds/button";
import { StatusChip } from "../ds/status-chip";

export type TriageRowMeta = {
  bankId: string;
  version: number;
  group: string | null;
  suggestedKey: string;
  suggestedCategory: string;
  categoryStrong: boolean;
  blocked: boolean;
  duplicate: boolean;
  accountKind: string;
  confirmKind: "income" | "expense" | null;
};

/**
 * Faixa de ação rápida para linhas bancárias pendentes na aba "A conferir".
 */
export function TriageRowControls({
  meta,
  reader,
  busy,
  confirmState,
  onConfirm,
  onEditCategory,
}: {
  meta: TriageRowMeta;
  reader: boolean;
  busy: boolean;
  confirmState?: ButtonState;
  onConfirm: () => void;
  onEditCategory: () => void;
}) {
  if (reader) return null;

  if (meta.blocked) {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-11 pb-2">
        <StatusChip tone="neutral" label="Aguardando o banco" />
        <span className="text-xs text-muted">
          Movimento provisório; poderá ser confirmado após compensar.
        </span>
      </div>
    );
  }

  if (meta.confirmKind && !meta.duplicate && meta.accountKind !== "card") {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-11 pb-2">
        <Button
          variant="quiet"
          size="sm"
          icon="check"
          disabled={busy}
          state={confirmState}
          busyLabel="Confirmando…"
          successLabel="Confirmado ✓"
          onClick={onConfirm}
        >
          Confirmar como {meta.suggestedCategory}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onEditCategory}
        >
          Trocar categoria
        </Button>
        <span className="text-xs text-muted">
          {meta.categoryStrong ? "regra salva" : "sugestão"}
        </span>
      </div>
    );
  }

  const neutralGroup =
    meta.group === "transfer" ||
    meta.group === "card" ||
    meta.group === "investment";

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-11 pb-2">
      {meta.duplicate ? (
        <StatusChip tone="warn" label="Possível repetição" />
      ) : meta.accountKind === "card" ? (
        <StatusChip tone="accent" label="Cartão · aguardando fatura" />
      ) : neutralGroup ? (
        <StatusChip tone="neutral" label="Conferir vínculo" />
      ) : (
        <StatusChip tone="neutral" label="Revisão manual" />
      )}
      {!neutralGroup && !meta.duplicate ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onEditCategory}
        >
          Categorizar
        </Button>
      ) : null}
    </div>
  );
}
