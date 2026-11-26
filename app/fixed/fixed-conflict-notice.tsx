"use client";
import { useRouter } from "next/navigation";
import { Button } from "../button";
import { Callout } from "../ds/callout";
import type { FixedConflict } from "./fixed-form-model.ts";

/**
 * Aviso de possível duplicidade: ligar o lançamento à conta fixa que já
 * existe, ver a existente ou criar outra mesmo assim.
 */
export function FixedConflictNotice({
  conflict,
  busy,
  onLink,
  onForce,
  onCancel,
}: {
  conflict: FixedConflict[];
  busy: boolean;
  onLink: (recurrenceId: string, label: string) => void;
  onForce: () => void;
  onCancel: () => void;
}) {
  const names = conflict.map((c) => c.label).join(", ");
  const router = useRouter();
  return (
    <Callout
      tone="warn"
      icon="!"
      title="Parece que você já tem esta conta fixa"
      details={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {conflict.map((c) => (
            <Button
              key={c.recurrence_id}
              variant="primary"
              busy={busy}
              onClick={() => onLink(c.recurrence_id, c.label)}
            >
              Ligar a {c.label}
            </Button>
          ))}
          <Button onClick={() => router.push("/espaco?painel=fixed")}>
            Ver a existente
          </Button>
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            Não criar
          </Button>
          <Button variant="quiet" onClick={onForce} disabled={busy}>
            Criar outra mesmo assim
          </Button>
        </div>
      }
    >
      Já existe: {names}. Ligar este lançamento a ela marca o mês como pago,
      sem criar outra conta fixa. Se criar de novo, ela pode aparecer em dobro
      nos Custos fixos.
    </Callout>
  );
}
