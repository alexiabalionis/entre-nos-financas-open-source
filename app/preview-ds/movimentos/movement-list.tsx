"use client";
import type { ReactNode } from "react";
import type { Row } from "./fixture.ts";

/** Lista por dia, como em family-movements.tsx: título do dia e linhas divididas. */
export function MovementList({ rows, children }: { rows: Row[]; children: (row: Row) => ReactNode }) {
  const days = [...new Set(rows.map((r) => r.date))];
  return (
    <div className="grid gap-4">
      {days.map((date) => (
        <section key={date}>
          <h3 className="mb-1 text-xs font-semibold uppercase opacity-60">
            {new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
              new Date(date + "T12:00:00Z"),
            )}
          </h3>
          <div className="ds-list list gap-0 divide-y divide-base-200">
            {rows.filter((r) => r.date === date).map((row) => (
              <div key={row.id}>{children(row)}</div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Texto do detalhe para o removido que só o banco pode trazer de volta. */
export function GoneNote({ row }: { row: Row }) {
  if (row.removed !== "banco") return null;
  return <p className="ds-caption mt-2">O banco não traz mais este movimento. Ele volta sozinho se reaparecer.</p>;
}
