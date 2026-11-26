"use client";
import { useEffect, useRef } from "react";
import { FamilyDialog } from "./family-dialog";
import { MovementForm } from "./movement-form";
import { useSession } from "../session/session-context";
import { useMonthData, monthCache } from "../hooks/use-month-data.ts";
import { api } from "../lib/api.ts";
import type { Action } from "../hooks/use-action.ts";

const INVESTMENT_KINDS = ["investment_buy", "investment_sell", "yield"];

/**
 * "Registrar movimento": usado pelo Mês, pelos Movimentos e pela Judite. Cada
 * tela renderiza a sua instância e passa a sua `action` (o aviso de sucesso
 * aparece na tela de quem abriu). A chave de idempotência nasce a cada
 * abertura e é reaproveitada em reenvios, como no open() antigo.
 */
export function RecordMovementDialog({
  open,
  initialKind,
  month,
  action,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialKind: string;
  month: string;
  action: Action;
  onClose: () => void;
  /** Roda depois de gravar: a tela dona recarrega seus dados. */
  onSaved: () => Promise<void> | void;
}) {
  const session = useSession();
  // Contas e categorias vêm do cache do mês (sem pedido novo quando já carregado).
  const { data } = useMonthData(
    month,
    "BRL",
    open ? session.user.email : null,
  );
  const operationId = useRef("");
  const { setError } = action;
  useEffect(() => {
    if (!open) return;
    operationId.current = crypto.randomUUID();
    setError("");
  }, [open, setError]);
  return (
    <FamilyDialog
      open={open}
      title={
        INVESTMENT_KINDS.includes(initialKind)
          ? "Registrar investimento"
          : "Registrar movimento"
      }
      busy={action.busy}
      error={action.error}
      onClose={onClose}
    >
      {data ? (
        <MovementForm
          key={initialKind}
          initialKind={initialKind}
          accounts={data.state.accounts}
          categories={data.state.categories}
          currency="BRL"
          busy={action.busy}
          submit={async (body) => {
            await action.work(async () => {
              await api("events", { ...body, request_id: operationId.current });
              onClose();
              monthCache.markStale();
              await onSaved();
            });
          }}
        />
      ) : (
        <p className="ds-caption">Carregando contas e categorias…</p>
      )}
    </FamilyDialog>
  );
}
