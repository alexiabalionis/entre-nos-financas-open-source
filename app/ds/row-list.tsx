"use client";
import { Row, type RowProps } from "./row";

type RowListProps = {
  /** Linhas da lista (cada uma é um RowProps completo). */
  rows: RowProps[];
  /** Borda entre as linhas. default true; passe false para legenda. */
  bordered?: boolean;
};

/**
 * Lista de linhas. Açúcar sobre Row: mapeia cada RowProps e aplica a borda
 * padrão (a linha pode sobrescrever com seu próprio bordered). Para legenda
 * (sem borda) use <RowList bordered={false} />.
 */
export function RowList({ rows, bordered = true }: RowListProps) {
  return (
    <div className="ds-list list gap-0">
      {rows.map((r, i) => (
        <Row key={i} {...r} bordered={r.bordered ?? bordered} />
      ))}
    </div>
  );
}
