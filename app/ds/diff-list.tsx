"use client";
import type { CSSProperties } from "react";
import { Icon } from "./icon.tsx";
import { StatusChip } from "./status-chip.tsx";
import type { Tone } from "./shared";
import type { DiffRow } from "./types.ts";

export type { DiffRow } from "./types.ts";

function senseOf(sense: number): { tone: Tone; word: string } {
  if (sense > 0) return { tone: "ok", word: "melhorou" };
  if (sense < 0) return { tone: "danger", word: "piorou" };
  return { tone: "neutral", word: "neutro" };
}

/**
 * Lista de antes -> depois. O valor antigo fica riscado, o novo em destaque e a
 * diferença numa etiqueta colorida (o sentido também vai em texto para leitor
 * de tela). Não calcula diferenças: tudo chega formatado.
 */
export function DiffList({ rows, empty = "Nada muda." }: { rows: DiffRow[]; empty?: string }) {
  if (rows.length === 0) {
    return <p className="ds-reset ds-diff-empty">{empty}</p>;
  }
  return (
    <ul className="ds-reset ds-diff">
      {rows.map((r, idx) => {
        const { tone, word } = senseOf(r.sense);
        return (
          <li key={r.key} className="ds-diff-row" style={{ "--i": Math.min(idx, 5) } as CSSProperties}>
            <span className="ds-diff-label">{r.label}</span>
            <span className="ds-diff-values">
              <s className="ds-diff-before">{r.before}</s>
              <Icon name="right" size={14} />
              <strong className="ds-diff-after">{r.after}</strong>
            </span>
            <span className="ds-diff-delta">
              <span className="sr-only">{word}</span>
              {r.delta ? <StatusChip label={r.delta} tone={tone} /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
