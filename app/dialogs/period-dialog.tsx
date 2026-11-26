"use client";
import { useState } from "react";
import { FamilyDialog } from "./family-dialog";
import { Button } from "../ds/button.tsx";
import { IconButton } from "../ds/icon-button.tsx";
import { cx } from "../ds/shared.ts";
import { currentMonth, monthTitle } from "../lib/dates.ts";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "Escolher mês": ano com setas e grade dos 12 meses; tocar num mês já abre. */
export function PeriodDialog({
  open,
  month,
  setMonth,
  onClose,
}: {
  open: boolean;
  month: string;
  setMonth: (month: string) => void;
  onClose: () => void;
}) {
  const today = currentMonth();
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  // Ao reabrir, o ano volta para o do mês selecionado (ajuste durante o render).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setYear(Number(month.slice(0, 4)));
  }
  const pick = (value: string) => {
    setMonth(value);
    onClose();
  };
  return (
    <FamilyDialog open={open} title="Escolher mês" busy={false} error="" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <IconButton icon="left" size="sm" label="Ano anterior" onClick={() => setYear((y) => y - 1)} />
          <strong className="text-base tabular-nums [font-family:var(--family-font-numeric)]" aria-live="polite">
            {year}
          </strong>
          <IconButton icon="right" size="sm" label="Próximo ano" onClick={() => setYear((y) => y + 1)} />
        </div>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={`Meses de ${year}`}>
          {MONTHS.map((name, i) => {
            const value = `${year}-${String(i + 1).padStart(2, "0")}`;
            const selected = value === month;
            const isToday = value === today;
            return (
              <button
                key={value}
                type="button"
                className={cx(
                  "btn btn-sm h-11 rounded-field font-medium capitalize",
                  selected ? "btn-primary" : "btn-ghost",
                  isToday && !selected && "border-primary/50 text-primary",
                )}
                aria-pressed={selected}
                aria-current={isToday ? "date" : undefined}
                aria-label={monthTitle(value)}
                onClick={() => pick(value)}
              >
                {name}
              </button>
            );
          })}
        </div>
        {month !== today && (
          <Button variant="text" className="self-center" onClick={() => pick(today)}>
            Voltar ao mês atual
          </Button>
        )}
      </div>
    </FamilyDialog>
  );
}
