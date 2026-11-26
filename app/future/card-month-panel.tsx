"use client";
import { useId, useState } from "react";
import { AnimatedMoney, CalcList, ChangedText, DisclosureButton } from "../ds/index.ts";
import { Collapse } from "../ds/collapse.tsx";
import { cx } from "../ds/shared.ts";
import { toReais } from "../lib/cents.ts";
import { monthShort } from "../../src/domain/future-months.ts";
import { useFutureContext } from "./future-context.tsx";
import { billChange, cardMonthLines, cardShare } from "./view-model.ts";

/**
 * Detalhe da fatura de um mês: valor e variação sobre o mês anterior sempre à
 * vista; os itens (parcelas, recorrentes, estimativa) e quanto sobra para
 * objetivos ficam recolhidos, e o cabeçalho abre e fecha. Desenha o
 * rascunho; sem cartão não mostra nada. Não calcula: tudo vem de view-model.
 */
export function CardMonthPanel({ index }: { index: number }) {
  const f = useFutureContext();
  const id = useId();
  // Começa recolhido; trocar de mês mantém a escolha.
  const [open, setOpen] = useState(false);
  const result = f.draft;
  const row = result?.rows[index];
  if (!result || !row || !f.draftInput || f.draftInput.cards.length === 0) return null;
  const change = billChange(result, index, f.hidden);
  return (
    <aside className={cx("ds-reset", "fut-card-month-panel")} aria-live="polite">
      <DisclosureButton
        className="fut-card-month-head"
        expanded={open}
        controls={id}
        onToggle={() => setOpen((o) => !o)}
        action={{ open: "Ver itens da fatura", close: "Recolher itens da fatura" }}
      >
        <span className="fut-card-month-sum">
          <span className="fut-card-month-title">
            Fatura de <ChangedText value={monthShort(row.month)} />
          </span>
          <span className="fut-card-month-big">
            <AnimatedMoney value={toReais(row.card)} hidden={f.hidden} />
            {change ? <small>{change}</small> : null}
          </span>
        </span>
      </DisclosureButton>
      <Collapse id={id} open={open}>
        <div className="fut-card-month-body">
          <CalcList lines={cardMonthLines(result, index)} hidden={f.hidden} />
          <p className="fut-card-month-share">{cardShare(result, index, f.hidden)}</p>
        </div>
      </Collapse>
    </aside>
  );
}
