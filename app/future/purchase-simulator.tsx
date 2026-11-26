"use client";
import { Select } from "../ds/select.tsx";
import { useId, useState } from "react";
import { AmountStepper, Button, Icon } from "../ds/index.ts";
import { cx } from "../ds/shared.ts";
import { formatCents, fromReais } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";
import {
  INSTALLMENT_CHOICES,
  SIMULATED_PURCHASE,
  installmentLabel,
  minFree,
  purchaseDayOptions,
} from "./view-model.ts";

/**
 * "E se vocês parcelarem uma compra?": valor, parcelas, cartão e dia. Aplica a
 * compra ao rascunho (uma só, chamada "Compra simulada") e mostra a menor folga
 * do horizonte. Não grava nada, então também funciona no modo leitura.
 */
export function PurchaseSimulator({ titled = true }: { titled?: boolean } = {}) {
  const f = useFutureContext();
  const id = useId();
  const input = f.draftInput;
  const [value, setValue] = useState(1800);
  const [times, setTimes] = useState(6);
  const [card, setCard] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  if (!input || input.cards.length === 0) return null;

  const chosenCard = card ?? input.cards[0].card;
  const chosenDay = day ?? input.today;
  const applied = f.scenario.purchases?.some((p) => p.label === SIMULATED_PURCHASE) ?? false;
  const apply = (next: { value?: number; times?: number; card?: string; day?: string } = {}) =>
    f.patch({
      purchases: [
        {
          card: next.card ?? chosenCard,
          cents: fromReais(next.value ?? value),
          installments: next.times ?? times,
          day: next.day ?? chosenDay,
          label: SIMULATED_PURCHASE,
        },
      ],
    });
  const horizon = f.draft ? Math.min(f.months, f.draft.rows.length) : 0;
  const lowest = f.draft ? minFree(f.draft, horizon) : 0n;

  return (
    <div className={cx("ds-reset", "fut-purchase")}>
      {titled ? <h3 className="fut-purchase-title">E se vocês parcelarem uma compra?</h3> : null}
      <div className="fut-purchase-row">
        <AmountStepper
          hidden={f.hidden}
          compact
          label="Valor total"
          value={value}
          step={100}
          min={100}
          onChange={(v) => {
            setValue(v);
            if (applied) apply({ value: v });
          }}
        />
        <div className="fut-field">
          <label htmlFor={`${id}-times`}>Parcelas</label>
          <Select
            id={`${id}-times`}
            value={times}
            onChange={(e) => {
              const t = Number(e.target.value);
              setTimes(t);
              if (applied) apply({ times: t });
            }}
          >
            {INSTALLMENT_CHOICES.map((t) => (
              <option key={t} value={t}>
                {installmentLabel(value, t, f.hidden)}
              </option>
            ))}
          </Select>
        </div>
        {input.cards.length > 1 ? (
          <div className="fut-field">
            <label htmlFor={`${id}-card`}>Cartão</label>
            <Select
              id={`${id}-card`}
              value={chosenCard}
              onChange={(e) => {
                setCard(e.target.value);
                if (applied) apply({ card: e.target.value });
              }}
            >
              {input.cards.map((c) => (
                <option key={c.card} value={c.card}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="fut-field">
          <label htmlFor={`${id}-day`}>Dia da compra</label>
          <Select
            id={`${id}-day`}
            value={chosenDay}
            onChange={(e) => {
              setDay(e.target.value);
              if (applied) apply({ day: e.target.value });
            }}
          >
            {purchaseDayOptions(input).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="fut-purchase-actions">
        {applied ? (
          <>
            <p className="fut-purchase-result" aria-live="polite">
              <Icon name="info" size={16} />
              <span>
                Folga mínima no horizonte: {formatCents(lowest, f.hidden)}
                {lowest < 0n ? ". Nos meses no vermelho, a diferença sai do saldo em conta." : "."}
              </span>
            </p>
            <Button variant="quiet" onClick={() => f.remove("purchases", SIMULATED_PURCHASE)}>
              Tirar a compra
            </Button>
          </>
        ) : (
          <Button onClick={() => apply()}>Simular na fatura</Button>
        )}
      </div>
    </div>
  );
}
