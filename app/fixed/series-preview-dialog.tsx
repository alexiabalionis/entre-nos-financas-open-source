"use client";
import { useState } from "react";
import { Button } from "../button";
import { RowList } from "../ds/row-list";
import { FamilyDialog } from "../dialogs/family-dialog";
import type { Action } from "../hooks/use-action.ts";
import { api } from "../lib/api.ts";
import { plainMoney } from "../../src/domain/format.ts";
import type { SeriesItem } from "./fixed-status.ts";
import { PreviewDecisionList } from "./preview-decision-list";
import { previewCopy, previewDone } from "./preview-copy.ts";
import {
  applyBody,
  canConfirm,
  changeText,
  decisionLabels,
  endBody,
  isStale,
  newAmount,
  pendingText,
  previewRows,
  type Choice,
  type Decisions,
  type PreviewMode,
} from "./preview-model.ts";
import { useSeriesPreview } from "./use-series-preview.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayShift(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
}

function endProblem(value: string, seriesStart: string): string {
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value + "T00:00:00Z"))) return "Escolha o último dia.";
  // A véspera do início vale: encerra antes da primeira conta, e nada fica previsto.
  return value < dayShift(seriesStart, -1) ? "O fim não pode ser antes do início da conta." : "";
}

/** "Esta e as próximas" e "Encerrar": mesma prévia, mesma regra de decidir cada ajuste à mão. */
export function SeriesPreviewDialog({
  mode,
  item,
  hidden,
  action,
  onBack,
  onDone,
  changes,
  from: fromOverride,
}: {
  mode: PreviewMode;
  item: SeriesItem;
  hidden: boolean;
  action: Action;
  onBack: () => void;
  onDone: (message: string) => void;
  /** Mudanças prontas do "Editar conta fixa": sem o campo de valor aqui. */
  changes?: Record<string, unknown>;
  /** "Editar conta fixa" com data antes desta conta: a prévia vale a partir dela. */
  from?: string;
}) {
  const { occurrence_date: occurrence, id, start_date: seriesStart } = item.recurrence;
  // Encerrar: o último dia vem do campo; o padrão é a véspera desta ocorrência.
  // A prévia só muda quando a data digitada é válida.
  const [endText, setEndText] = useState(dayShift(occurrence, -1));
  const [endFrom, setEndFrom] = useState(occurrence);
  const endError = mode === "end" ? endProblem(endText, seriesStart) : "";
  const from = mode === "end" ? endFrom : (fromOverride ?? occurrence);
  const { preview, error, loading, reload } = useSeriesPreview(id, from);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [amountText, setAmountText] = useState(
    item.planned_cents ? plainMoney(item.planned_cents) : "",
  );
  const amount = newAmount(amountText);
  const subject = { label: item.label, month: item.month, from, end: mode === "end" ? dayShift(from, -1) : undefined };
  const copy = previewCopy(mode, subject);
  const amountOk = mode === "end" ? !endError : changes !== undefined || "cents" in amount;
  const ready =
    !!preview && amountOk && canConfirm(preview.groups, decisions);

  const confirm = () => {
    if (!preview || !ready) return;
    void action.work(async () => {
      if (mode === "next" && changes)
        await api("recurrences/apply", applyBody(preview, changes, decisions));
      else if (mode === "next" && "cents" in amount)
        await api("recurrences/apply", applyBody(preview, amount.cents, decisions));
      else await api("recurrences/end", endBody(preview, decisions));
      onDone(previewDone(mode, subject, preview.groups, decisions));
    });
  };
  const decide = (itemId: string, choice: Choice) =>
    setDecisions((d) => ({ ...d, [itemId]: choice }));
  const again = () => {
    action.setError("");
    setDecisions({});
    reload();
  };

  return (
    <FamilyDialog
      open
      title={changes ? "Editar conta fixa" : copy.title}
      busy={action.busy}
      error={action.error}
      onClose={onBack}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <p className="ds-caption">{copy.intro}</p>
        {mode === "end" && (
          <label>
            Último dia da conta fixa
            <input
              name="end_date"
              type="date"
              min={dayShift(seriesStart, -1)}
              value={endText}
              aria-invalid={endError !== ""}
              aria-describedby="series-end-error"
              onChange={(e) => {
                const value = e.target.value;
                setEndText(value);
                setDecisions({});
                if (!endProblem(value, seriesStart)) setEndFrom(dayShift(value, 1));
              }}
            />
          </label>
        )}
        {mode === "end" && endError && (
          <p className="text-error text-sm" id="series-end-error" role="alert">
            {endError}
          </p>
        )}
        {mode === "end" && !endError && endText < seriesStart && (
          <p className="ds-caption">
            Termina antes da primeira conta: {item.label} deixa de ser prevista em todos os meses.
          </p>
        )}
        {mode === "next" && !changes && (
          <label>
            Novo valor
            <input
              name="amount"
              inputMode="decimal"
              value={amountText}
              aria-invalid={!amountOk}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </label>
        )}
        {mode === "next" && !changes && "error" in amount && (
          <p className="alert alert-soft alert-error" role="alert">
            {amount.error}
          </p>
        )}
        {loading && (
          <p className="ds-caption" role="status">
            Carregando a prévia…
          </p>
        )}
        {error && (
          <>
            <p className="alert alert-soft alert-error" role="alert">
              {error}
            </p>
            <Button variant="quiet" onClick={again}>
              Tentar de novo
            </Button>
          </>
        )}
        {preview && (
          <>
            <p>
              <strong>O que vai acontecer</strong>
            </p>
            <RowList
              rows={previewRows(
                preview.groups,
                mode,
                changes ? "" : changeText(item.planned_cents, amount, item.currency, hidden),
              ).map((row) => ({
                icon: String(row.count),
                tone: row.tone,
                title: row.title,
                sub: row.detail,
              }))}
            />
            <PreviewDecisionList
              entries={preview.groups.edited}
              decisions={decisions}
              labels={decisionLabels(mode)}
              onDecide={decide}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                variant="primary"
                disabled={action.busy || !ready}
              >
                {copy.confirm}
              </Button>
              <Button variant="quiet" disabled={action.busy} onClick={onBack}>
                Voltar
              </Button>
              {isStale(action.error) && (
                <Button variant="quiet" onClick={again}>
                  Ver a prévia de novo
                </Button>
              )}
            </div>
            <p className="ds-caption" role="status">
              {pendingText(preview.groups, decisions)}
            </p>
          </>
        )}
      </form>
    </FamilyDialog>
  );
}
