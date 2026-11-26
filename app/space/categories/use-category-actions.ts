"use client";
import { useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { useFlashKey } from "./use-flash-key.ts";

/**
 * Gravações de categorias e etiquetas. Cada ação devolve "" quando deu certo ou a
 * mensagem de erro, para quem chama mostrar no próprio lugar. Só uma roda por vez.
 */
export function useCategoryActions(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [flashId, flash] = useFlashKey();
  const running = useRef(false);

  async function run(action: () => Promise<string | null>): Promise<string> {
    if (running.current) return "Aguarde a gravação anterior terminar.";
    running.current = true;
    setBusy(true);
    try {
      const flashed = await action();
      await refresh();
      if (flashed) flash(flashed);
      return "";
    } catch (e) {
      return e instanceof Error ? e.message : "Não foi possível salvar. Tente novamente.";
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return {
    busy,
    flashId,
    createTag: (categoryId: string, name: string) =>
      run(async () => (await api<{ id: string }>("categories/tags", { category_id: categoryId, name })).id),
    renameTag: (tagId: string, name: string) =>
      run(async () => {
        await api("categories/tags/rename", { tag_id: tagId, name });
        return tagId;
      }),
    deleteTag: (tagId: string) =>
      run(async () => {
        await api("categories/tags/delete", { tag_id: tagId });
        return null;
      }),
    saveCategory: (input: { id?: string; name: string; essential: boolean }) =>
      run(async () => {
        await api("categories", input);
        return null;
      }),
  };
}
