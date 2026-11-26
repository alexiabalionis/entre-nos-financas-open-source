"use client";
import { Select } from "../ds/select.tsx";
import { useState } from "react";
import { Button } from "../ds/button.tsx";
import { Field } from "../field";
import { CategoryPicker } from "../family-categories";
import { formValues } from "../lib/form.ts";
import { today } from "../lib/dates.ts";
import { isPairedKind, movementBody } from "./movement-payload.ts";
import type { Data } from "../hooks/use-month-data.ts";
import type { Currency } from "../../src/domain/finance.ts";

export function MovementForm({
  initialKind = "expense",
  accounts,
  categories,
  currency,
  busy,
  submit,
}: {
  initialKind?: string;
  accounts: Data["state"]["accounts"];
  categories: Data["state"]["categories"];
  currency: Currency;
  busy: boolean;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [kind, setKind] = useState(initialKind),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const account = accounts.find((a) => a.id === from),
    counter = accounts.find((a) => a.id === to),
    paired = isPairedKind(kind);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        const v = formValues(e);
        // Valor inválido segue indo como {} para a API responder o erro (igual a antes).
        void submit(movementBody(v, kind, to, counter?.currency) ?? {});
      }}
    >
      <Field label="O que aconteceu?">
        <Select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="expense">Gasto fora do plano</option>
          <option value="income">Entrada extra</option>
          <option value="transfer">Transferência entre nossas contas</option>
          <option value="card_payment">Pagamento de fatura</option>
          <option value="fx">Conversão de moeda</option>
          <option value="investment_buy">Aporte em investimento</option>
          <option value="investment_sell">Resgate de investimento</option>
          <option value="yield">Rendimento</option>
        </Select>
      </Field>
      <Field label="Descrição">
        <input
          name="description"
          required
          maxLength={180}
          placeholder="Ex.: passeio em família…"
        />
      </Field>
      <Field
        label={
          kind === "investment_sell"
            ? "Conta que recebeu o resgate"
            : paired
              ? "Saiu de"
              : "Conta"
        }
      >
        <Select
          name="account_id"
          required
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setTo("");
          }}
        >
          <option value="">Escolher conta</option>
          {accounts
            .filter(
              (a) =>
                a.currency === currency &&
                (kind !== "card_payment" || a.kind !== "card"),
            )
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
        </Select>
      </Field>
      {paired && (
        <Field
          label={kind === "investment_sell" ? "Investimento resgatado" : "Foi para"}
        >
          <Select
            name="counter_account_id"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
          >
            <option value="">Escolher destino</option>
            {accounts
              .filter(
                (a) =>
                  a.id !== from &&
                  (kind === "fx"
                    ? a.currency !== account?.currency
                    : a.currency === account?.currency) &&
                  (kind !== "card_payment" || a.kind === "card") &&
                  (!["investment_buy", "investment_sell"].includes(kind) ||
                    a.kind === "investment"),
              )
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <Field label={`Valor ${account?.currency ?? currency}`}>
        <input
          name="amount"
          inputMode="decimal"
          pattern="[0-9.]+,[0-9]{2}"
          placeholder="0,00"
          required
        />
      </Field>
      {kind === "fx" && (
        <Field label={`Valor recebido em ${counter?.currency ?? "outra moeda"}`}>
          <input
            name="counter_amount"
            inputMode="decimal"
            pattern="[0-9.]+,[0-9]{2}"
            placeholder="0,00"
            required
          />
        </Field>
      )}
      <Field label="Data">
        <input name="date" type="date" required defaultValue={today()} />
      </Field>
      {!paired && (
        <CategoryPicker
          categories={categories}
          required
        />
      )}
      {paired && (
        <p className="ds-caption">
          Registra os dois lados uma única vez. Transferir ou converter seu
          dinheiro não cria renda nem consumo.
        </p>
      )}
      {/* Mesmo rodapé dos outros diálogos: principal à direita no desktop,
          largura toda no celular. */}
      <div className="mt-1 flex justify-end">
        <Button
          type="submit"
          variant="primary"
          className="w-full sm:w-auto"
          disabled={busy}
        >
          {busy ? "Salvando…" : "Registrar para nós dois"}
        </Button>
      </div>
    </form>
  );
}
