"use client";
import type { CSSProperties, ReactNode } from "react";
import { Collapsible } from "../../collapsible.tsx";
import { CategoryIcon } from "../../family-categories.tsx";
import { FamilyIcon } from "../../family-extras.tsx";
import { IconBadge } from "../../ds/icon-badge.tsx";
import { StatusChip } from "../../ds/status-chip.tsx";
import { RowMenu, type RowMenuItem } from "../../movements/row-menu.tsx";
import { categoryColor } from "../../../src/domain/category-color.ts";
import { brDate } from "../../../src/domain/format.ts";
import { account, KIND_LABEL, money, neutral, type Row } from "./fixture.ts";

/**
 * A linha de Movimentos como no app (family-movements.tsx): ícone, título,
 * conta e selos, valor, detalhe ao abrir e menu "⋯". Acrescenta só o que a
 * fase 4 traz: selo de removido e de "o app decidiu", e um espaço de ajuste.
 */
export function MovementRow({
  row,
  menu,
  flash,
  children,
  open,
  onOpenChange,
}: {
  row: Row;
  menu: RowMenuItem[];
  flash?: string;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const flat = neutral(row.kind);
  const counter = account(row.counterId);
  const where = account(row.accountId)?.name ?? "";
  const situation = row.removed
    ? row.removed === "banco"
      ? "O banco não traz mais · fora dos totais"
      : "Removido · fora dos totais"
    : flat
      ? "Entre contas · não conta nos totais"
      : row.kind === "card_purchase"
        ? "Compra no cartão · entra na fatura"
        : "Confirmado";
  return (
    <div className="relative">
      <Collapsible
        className={"rounded-none border-0 bg-transparent [&_summary]:pr-14" + (row.removed ? " opacity-60" : "")}
        arrow={false}
        open={open}
        onOpenChange={onOpenChange}
        summary={
          <>
            <IconBadge
              tone={row.category ? undefined : flat ? "neutral" : row.cents > 0 ? "ok" : "danger"}
              {...(row.category
                ? {
                    "data-cat": "",
                    style: { "--tone": categoryColor(row.category), "--badge-color": categoryColor(row.category) } as CSSProperties,
                  }
                : {})}
              icon={
                flat ? (
                  <FamilyIcon name="movements" />
                ) : row.category ? (
                  <CategoryIcon name={row.category} />
                ) : (
                  <span aria-hidden="true">{row.cents > 0 ? "↙" : "↗"}</span>
                )
              }
            />
            <span className="min-w-0 flex-1">
              <strong className={"line-clamp-2 text-sm font-medium" + (row.removed ? " line-through" : "")}>
                {row.description}
              </strong>
              <small className="block text-xs opacity-60 pt-2">
                {counter ? `${where} → ${counter.name}` : where}
                {row.removed && <StatusChip className="ml-1.5" ghost tone="warn" icon="" label="Fora dos totais" />}
                {!row.removed && row.auto && <StatusChip className="ml-1.5" ghost icon="" label={KIND_LABEL[row.kind]} />}
                {flash && <StatusChip className="ml-1.5" tone="ok" icon="✓" label={flash} />}
              </small>
            </span>
            <strong
              className={
                "text-sm font-medium whitespace-nowrap tabular-nums" +
                (flat || row.removed ? " opacity-60" : row.cents > 0 ? " text-success" : "")
              }
            >
              {money(row.cents)}
            </strong>
          </>
        }
      >
        <dl className="grid gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-xs opacity-60">Tipo</dt>
            <dd className="text-xs">
              {KIND_LABEL[row.kind]}
              {row.auto && <span className="opacity-60"> · decidido pelo app</span>}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs opacity-60">Data</dt>
            <dd className="text-xs">{brDate(row.date)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs opacity-60">Situação</dt>
            <dd className="text-right text-xs">{situation}</dd>
          </div>
        </dl>
        {children}
      </Collapsible>
      <RowMenu label={`Mais ações: ${row.description}`} items={menu} />
    </div>
  );
}
