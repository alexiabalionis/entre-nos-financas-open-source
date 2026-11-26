"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../button";
import { Collapse } from "../ds/collapse";
import { StatusChip } from "../ds/status-chip";
import { BudgetReference } from "./budget-reference";
import { BudgetNums, BudgetSummary } from "./budget-summary";
import { STATE_VIEW, type Money } from "./budget-view-model.ts";
import type { OutflowRowModel } from "./outflow-model.ts";

type Props = {
  row: OutflowRowModel;
  open: boolean;
  fmt: Money;
  month: string;
  hidden: boolean;
  reader: boolean;
  onToggle: () => void;
  onDetail: (categoryId: string) => void;
  onForm: (categoryId: string, cents?: bigint) => void;
};

/** Uma categoria: linha que nomeia a fatia e, aberta, mostra o teto. */
export function OutflowRow(props: Props) {
  const { row, open, fmt, onToggle } = props;
  const view = row.card ? STATE_VIEW[row.card.state] : null;
  const bodyId = `outflow-${row.key}`;
  // Só monta o conteúdo na primeira abertura (a referência busca no servidor);
  // depois fica montado para o fechar também animar.
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className="border-t border-base-300 first:border-t-0">
      <button
        type="button"
        // Grade própria + utilitários que zeram a base legada de <button>
        // (inline-flex centralizado, borda, fundo, raio, 46px).
        className="grid min-h-0 w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-none border-0 bg-transparent px-0 py-3 text-left [color:inherit] [font:inherit] hover:bg-transparent"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="size-3 shrink-0 rounded-sm" style={{ background: row.color }} aria-hidden="true" />
        <span className="flex min-w-0 flex-col items-start gap-1">
          <strong className="text-sm font-medium">{row.name}</strong>
          {view ? (
            <StatusChip tone={view.tone} label={view.chip} />
          ) : (
            <small className="text-xs opacity-60">{row.categoryId ? "Sem teto" : "Saídas sem categoria"}</small>
          )}
        </span>
        <span className="flex flex-col items-end tabular-nums">
          <b className="text-sm font-medium whitespace-nowrap">
            {fmt(row.committed)}
            <span className="ds-collapse-arrow ml-1 opacity-50" aria-hidden="true">↓</span>
          </b>
          <small className="text-xs opacity-60">{row.percent}%</small>
        </span>
      </button>
      <Collapse id={bodyId} open={open}>
        <div className="flex flex-col gap-3 pb-3">
          {seen && <OutflowBody {...props} />}
        </div>
      </Collapse>
    </div>
  );
}

function OutflowBody({ row, fmt, month, hidden, reader, onDetail, onForm }: Props) {
  const router = useRouter();
  const id = row.categoryId;
  if (row.card && id)
    return (
      <>
        <BudgetSummary card={row.card} fmt={fmt} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDetail(id)}>Ver o que compõe</Button>
          {!reader && (
            <Button size="sm" variant="quiet" onClick={() => onForm(id)}>
              Alterar o teto
            </Button>
          )}
        </div>
      </>
    );
  const nums = (
    <BudgetNums
      items={[
        ["Já gastou", fmt(row.spent)],
        ["Ainda vai pagar", fmt(row.open)],
      ]}
    />
  );
  if (!id)
    return (
      <>
        {nums}
        <p className="ds-caption">
          Dê uma categoria a essas saídas em Movimentos para elas entrarem na
          conta certa.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => router.push("/movimentos")}>
            Ir para Movimentos
          </Button>
        </div>
      </>
    );
  return (
    <>
      {nums}
      <BudgetReference
        categoryId={id}
        month={month}
        fmt={fmt}
        hidden={hidden || reader}
        onUse={(cents) => onForm(id, cents)}
      />
      {!reader && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => onForm(id)}>
            Definir um teto
          </Button>
        </div>
      )}
    </>
  );
}
