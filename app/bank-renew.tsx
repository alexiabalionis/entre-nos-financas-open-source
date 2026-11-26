"use client";
import { useState } from "react";
import { Button } from "./ds/button";
import { Select } from "./ds/select";
import { Collapsible } from "./collapsible";
import { Field } from "./field";
import { api, fields } from "./bank-api";
import type { renewBank } from "../src/server/banks.ts";

type Renewal = Awaited<ReturnType<typeof renewBank>>;

/** Renovação da autorização preservando vínculos e histórico. */
export function RenewBank({
  connection,
  busy,
  ready,
  completed,
}: {
  connection: string;
  busy: boolean;
  ready: boolean;
  completed: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Renewal | null>(null),
    [item, setItem] = useState(""),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  return (
    <Collapsible
      defaultOpen
      summary="Renovar autorização sem criar outras contas"
    >
      <p className="ds-caption text-xs opacity-60">
        Depois de renovar no Meu Pluggy e autorizar novamente no painel, informe
        o novo itemId. Confira as correspondências; finais iguais e nomes
        parecidos não comprovam que são a mesma conta.
      </p>
      {error && (
        <p role="alert" className="family-error alert alert-soft alert-error">
          {error}
        </p>
      )}
      {!preview ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            const v = fields(e);
            setWorking(true);
            setError("");
            try {
              const result = await api<Renewal>("banks/renew", {
                id: connection,
                item_id: v.item_id,
              });
              setItem(String(v.item_id));
              setPreview(result);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Tente novamente.");
            } finally {
              setWorking(false);
            }
          }}
        >
          <Field label="Novo itemId">
            <input
              name="item_id"
              required
              maxLength={36}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <button
            className="btn btn-sm btn-primary"
            disabled={busy || working || !ready}
          >
            Conferir nova autorização
          </button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            const v = fields(e);
            setWorking(true);
            setError("");
            try {
              await api("banks/renew", {
                id: connection,
                item_id: item,
                confirm: true,
                mappings: preview.previous.map((old) => ({
                  bank_account_id: old.id,
                  remote_account_id: v[old.id],
                })),
              });
              setPreview(null);
              await completed();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Tente novamente.");
            } finally {
              setWorking(false);
            }
          }}
        >
          {preview.previous.map((old) => (
            <Field
              key={old.id}
              label={
                <>
                  {old.label}
                  {old.last_four ? " · final " + old.last_four : ""}
                </>
              }
            >
              <Select name={old.id} required defaultValue="">
                <option value="">
                  Escolha a mesma conta na nova autorização
                </option>
                {preview.remote
                  .filter(
                    (a) =>
                      a.currency === old.currency &&
                      a.account_type === old.account_type,
                  )
                  .map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.label}
                      {a.last_four ? " · final " + a.last_four : ""}
                    </option>
                  ))}
              </Select>
            </Field>
          ))}
          <label className="bank-consent flex items-start gap-2 text-sm">
            <input type="checkbox" required />
            Conferi que são as mesmas contas. Quero preservar os vínculos e o
            histórico.
          </label>
          <Button type="submit" variant="primary" disabled={busy || working}>
            Confirmar renovação dos vínculos
          </Button>
          <button
            className="btn btn-sm btn-soft"
            type="button"
            disabled={working}
            onClick={() => setPreview(null)}
          >
            Recomeçar conferência
          </button>
        </form>
      )}
    </Collapsible>
  );
}
