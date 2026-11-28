"use client";
import { Row, type RowProps } from "./row";

type RowListProps = {
  /** Linhas da lista. */
  rows: RowProps[];
  /** Borda entre as linhas. default true; passe false para legenda. */
  bordered?: boolean;
};

/**
 * Lista de linhas em Tailwind puro.
 */
export function RowList({ rows, bordered = true }: RowListProps) {
  return (
    <div className="ds-list flex flex-col gap-0">
      {rows.map((r, i) => (
        <Row key={i} {...r} bordered={r.bordered ?? bordered} />
      ))}
    </div>
  );
}
