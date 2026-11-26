"use client";
import { useState } from "react";
import { Button } from "../button";
import { Field } from "../field";
import { Select } from "../ds/select";
import { FamilyDialog } from "../dialogs/family-dialog";
import { movementTitle, type Movement } from "../../src/domain/movements.ts";
import {
  ADJUST_EFFECT,
  ADJUST_LABEL,
  counterAccounts,
  kindsFor,
  missingField,
  needsCategory,
  needsCounter,
  type AdjustDraft,
  type AdjustKind,
} from "../../src/domain/movement-kind.ts";

type ButtonState = "idle" | "loading" | "success" | "error";
type Option = { id: string; name: string };
export type KindChoices = {
  accounts: (Option & { kind: string })[];
  categories: Option[];
  /** Compras que podem ter sido estornadas por esta linha. */
  purchases: Option[];
};

const MISSING = {
  counter: "Escolha a outra conta.",
  related: "Escolha a compra que foi estornada.",
  category: "Escolha a categoria.",
};

/**
 * "Mudar tipo" de um lançamento confirmado (menu "⋯"). Mostra só os tipos que
 * cabem no movimento e só o campo que o tipo pede. Falta algo: bloqueia o envio
 * e mostra o erro no campo. Quem chama grava e fecha pelo `close`.
 */
export function ChangeKindDialog({
  open,
  row,
  choices,
  busy,
  error,
  state,
  onClose,
  onConfirm,
}: {
  open: boolean;
  row: Movement;
  choices: KindChoices;
  busy: boolean;
  error: string;
  state?: ButtonState;
  onClose: () => void;
  onConfirm: (draft: AdjustDraft, close: () => void) => void;
}) {
  const cents = BigInt(row.amount);
  const accountKind = choices.accounts.find((a) => a.id === row.accountId)?.kind ?? "";
  const kinds = kindsFor(accountKind, cents);
  const start = (): AdjustDraft => ({
    kind: kinds.includes(row.kind as AdjustKind) ? (row.kind as AdjustKind) : kinds[0],
    counterAccountId: row.counterAccountId ?? null,
    relatedEventId: row.relatedEventId ?? null,
    categoryId: choices.categories.find((c) => c.name === row.category)?.id ?? null,
  });
  const [draft, setDraft] = useState(start);
  const [tried, setTried] = useState(false);
  const missing = tried ? missingField(draft) : null;
  const set = (patch: Partial<AdjustDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const close = () => {
    setTried(false);
    setDraft(start());
    onClose();
  };
  const select = (field: "counter" | "related" | "category", value: string | null, options: Option[], key: keyof AdjustDraft, label: string) => (
    <Field label={label} error={missing === field ? MISSING[field] : undefined}>
      <Select value={value ?? ""} aria-invalid={missing === field || undefined} onChange={(e) => set({ [key]: e.target.value || null })}>
        <option value="">Escolha</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </Field>
  );
  return (
    <FamilyDialog open={open} title="Mudar o tipo deste movimento" description={movementTitle(row)} busy={busy} error={open ? error : ""} onClose={close}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          if (!missingField(draft)) onConfirm(draft, close);
        }}
      >
        {kinds.length > 1 ? (
          <Field label="O que foi este movimento" hint={ADJUST_EFFECT[draft.kind]}>
            <Select value={draft.kind} onChange={(e) => set({ kind: e.target.value as AdjustKind })}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {ADJUST_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="ds-caption">
            {ADJUST_LABEL[kinds[0]]}. {ADJUST_EFFECT[kinds[0]]}
          </p>
        )}
        {needsCounter(draft.kind) &&
          select(
            "counter",
            draft.counterAccountId,
            counterAccounts(choices.accounts, row.accountId ?? "", draft.kind),
            "counterAccountId",
            draft.kind === "card_payment" ? "Fatura de qual cartão" : "Para qual conta",
          )}
        {draft.kind === "refund" && select("related", draft.relatedEventId, choices.purchases, "relatedEventId", "Qual compra foi estornada")}
        {needsCategory(draft.kind) && select("category", draft.categoryId, choices.categories, "categoryId", "Categoria")}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" state={state} busyLabel="Salvando…">
            Salvar
          </Button>
          <Button type="button" variant="quiet" disabled={busy} onClick={close}>
            Voltar
          </Button>
        </div>
      </form>
    </FamilyDialog>
  );
}
