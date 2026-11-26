"use client";
import { Field } from "../../field.tsx";
import { Select } from "../../ds/select.tsx";
import {
  CATEGORIES,
  counterOptions,
  KIND_LABEL,
  kindsFor,
  money,
  needsCounter,
  neutral,
  refundOptions,
  type Change,
  type Row,
} from "./fixture.ts";

/** Ponto de partida do formulário: o que o movimento é hoje. */
export const draftOf = (r: Row): Change => ({
  kind: r.kind,
  category: r.category,
  counterId: r.counterId,
  relatedId: r.relatedId,
});

// O que cada tipo faz com os totais, dito para a pessoa.
const EFFECT: Record<Change["kind"], string> = {
  expense: "Conta como gasto do mês.",
  income: "Conta como entrada do mês.",
  card_purchase: "Conta como gasto e entra na fatura.",
  refund: "Diminui o gasto da compra estornada.",
  transfer: "Não conta como gasto nem entrada. O saldo das contas não muda.",
  card_payment: "Não conta como gasto. A compra já contou quando foi feita.",
};

/**
 * Campos da troca de tipo, os mesmos nas três opções: só os tipos que cabem no
 * movimento, e só o campo que o tipo escolhido pede (outra conta, compra
 * estornada ou categoria). Quem usa guarda o rascunho e valida ao salvar.
 */
export function KindFields({
  row,
  rows,
  value,
  error,
  onChange,
}: {
  row: Row;
  rows: Row[];
  value: Change;
  error: string;
  onChange: (c: Change) => void;
}) {
  const kinds = kindsFor(row);
  const set = (patch: Partial<Change>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-3">
      {kinds.length > 1 ? (
        <Field label="O que foi este movimento" hint={EFFECT[value.kind]}>
          <Select value={value.kind} onChange={(e) => set({ kind: e.target.value as Change["kind"] })}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="ds-caption">
          {KIND_LABEL[kinds[0]]}. {EFFECT[kinds[0]]}
        </p>
      )}
      {needsCounter(value.kind) && (
        <Field label={value.kind === "card_payment" ? "Fatura de qual cartão" : "Para qual conta"} error={error.includes("conta") ? error : ""}>
          <Select value={value.counterId ?? ""} onChange={(e) => set({ counterId: e.target.value || null })}>
            <option value="">Escolha</option>
            {counterOptions(row, value.kind).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {value.kind === "refund" && (
        <Field label="Qual compra foi estornada" error={error.includes("compra") ? error : ""}>
          <Select value={value.relatedId ?? ""} onChange={(e) => set({ relatedId: e.target.value || null })}>
            <option value="">Escolha</option>
            {refundOptions(rows, row).map((p) => (
              <option key={p.id} value={p.id}>
                {p.description} · {money(p.cents)}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {!neutral(value.kind) && value.kind !== "refund" && (
        <Field label="Categoria" error={error.includes("categoria") ? error : ""}>
          <Select value={value.category ?? ""} onChange={(e) => set({ category: e.target.value || null })}>
            <option value="">Escolha</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
