"use client";
import { useId, useState } from "react";
import { Panel } from "../ds/panel.tsx";
import { Button } from "../ds/button.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import { parseAmount } from "./model.ts";
import type { Money } from "./money.ts";

export function MarginPanel({
  copilot,
  money,
  reader,
  write,
}: {
  copilot: CopilotWire;
  money: Money;
  reader: boolean;
  write: (w: CopilotWrite) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const margin = BigInt(copilot.margin);

  const save = async (amount: string | null) => {
    setBusy(true);
    setError("");
    try {
      await write({ kind: "margin", amount });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    if (/^0+(,0{1,2})?$/.test(value.trim())) return void save("0,00");
    const parsed = parseAmount(value, null, money);
    if (!parsed.ok) return setError(parsed.error);
    void save(parsed.value);
  };

  return (
    <Panel title="Margem de segurança" meta={money(margin)} className="mb-0">
      <p className="ds-caption">
        O mínimo que fica na conta até o salário, para imprevistos. Não é para
        gastar e não é reserva.
        {copilot.marginChosen
          ? ""
          : " Hoje vale o padrão: meia semana do dia a dia de sempre."}
      </p>
      {!reader && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(true);
              setValue("");
              setError("");
            }}
          >
            Alterar a margem
          </Button>
          {copilot.marginChosen && (
            <Button
              variant="quiet"
              size="sm"
              busy={busy}
              onClick={() => void save(null)}
            >
              Voltar ao padrão
            </Button>
          )}
        </div>
      )}
      {!reader && editing && (
        <div className="flex flex-col gap-2.5">
          <label className="text-xs font-medium text-ink" htmlFor={inputId}>
            Margem, em reais
          </label>
          <input
            id={inputId}
            inputMode="decimal"
            placeholder="Ex.: 300"
            value={value}
            className="font-numeric text-base"
            aria-invalid={error ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" busy={busy} onClick={submit}>
              Salvar margem
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-3 py-2 text-xs font-medium text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </Panel>
  );
}
