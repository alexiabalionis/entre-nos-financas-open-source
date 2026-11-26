"use client";
import { Select } from "../ds/select";
import { useState } from "react";
import { Button } from "../button";
import { useFixedOverview } from "../hooks/use-fixed-overview.ts";

/** "Ligar a uma conta fixa que já existe": escolhe a conta e liga o lançamento a ela. */
export function LinkExistingSeries({
  month,
  busy,
  onLink,
}: {
  month: string;
  busy: boolean;
  onLink: (recurrenceId: string, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { overview, error } = useFixedOverview(month, open);
  const [chosen, setChosen] = useState("");
  const series = overview?.series.filter((s) => !s.paused) ?? [];
  const pick = series.find((s) => s.id === chosen);
  return (
    <div className="fixed-link-existing">
      <Button variant="text" aria-expanded={open} onClick={() => setOpen(!open)}>
        Já é uma conta fixa? Ligar a ela
      </Button>
      {open && <>
      {error && (
        <p className="alert alert-soft alert-error" role="alert">
          {error}
        </p>
      )}
      {open && !overview && !error && (
        <p className="ds-caption" role="status">
          Carregando as contas fixas…
        </p>
      )}
      {overview && series.length === 0 && (
        <p className="ds-caption">Ainda não há contas fixas para ligar.</p>
      )}
      {series.length > 0 && (
        <>
          <label>
            Conta fixa
            <Select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">Escolha</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <p className="ds-caption">
            O lançamento vira o pagamento do mês dessa conta. Nada novo é criado.
          </p>
          <Button
            variant="primary"
            busy={busy}
            disabled={!pick}
            onClick={() => pick && onLink(pick.id, pick.label)}
          >
            Ligar
          </Button>
        </>
      )}
      </>}
    </div>
  );
}
