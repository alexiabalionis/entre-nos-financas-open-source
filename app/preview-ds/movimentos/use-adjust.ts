"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RowMenuItem } from "../../movements/row-menu.tsx";
import { changeError, type Change, type Row } from "./fixture.ts";
import type { Store } from "./frame.tsx";

/**
 * Ações de ajuste comuns às três opções: salvar o tipo (com a mesma validação
 * do servidor), remover, voltar a contar e o aviso de sucesso que aparece na
 * própria linha. Cada opção só decide onde o formulário abre.
 */
export function useAdjust(store: Store) {
  const [flash, setFlash] = useState<{ id: string; label: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const done = useCallback((id: string, label: string) => {
    window.clearTimeout(timer.current);
    setFlash({ id, label });
    timer.current = window.setTimeout(() => setFlash(null), 1600);
  }, []);
  const save = (row: Row, change: Change): string => {
    const error = changeError(store.rows, row, change);
    if (error) return error;
    store.dispatch({ type: "change", id: row.id, change });
    done(row.id, "Tipo corrigido");
    return "";
  };
  const remove = (row: Row) => {
    store.dispatch({ type: "remove", id: row.id });
    done(row.id, "Removido");
  };
  const restore = (row: Row) => {
    store.dispatch({ type: "restore", id: row.id });
    done(row.id, "Voltou a contar");
  };
  /**
   * Itens do menu "⋯": quem chama passa o que abre o ajuste e a remoção.
   * combined: um item "Ajustar" só, que leva às duas coisas (opção B).
   */
  const menu = (row: Row, open: { adjust: () => void; remove: () => void }, combined = false): RowMenuItem[] => {
    if (store.reader) return [];
    if (row.removed === "você") return [{ label: "Voltar a contar", icon: "↺", onSelect: () => restore(row) }];
    if (row.removed) return [];
    const rename: RowMenuItem = { label: "Renomear", icon: "✎", onSelect: () => undefined };
    if (combined) return [rename, { label: "Ajustar", icon: "⇄", onSelect: open.adjust }];
    return [
      rename,
      { label: "Mudar tipo", icon: "⇄", onSelect: open.adjust },
      { label: "Remover", icon: "✕", tone: "danger", onSelect: open.remove },
    ];
  };
  const flashOf = (row: Row) => (flash?.id === row.id ? flash.label : undefined);
  return { save, remove, restore, menu, flashOf };
}
