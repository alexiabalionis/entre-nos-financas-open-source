"use client";
import { useState } from "react";
import { Icon } from "../../../ds/index.ts";
import { Callout } from "../../../ds/callout.tsx";
import type { Store } from "../frame.tsx";
import { INTRO } from "../fixture.ts";
import { CategoryDetail } from "./category-detail.tsx";
import { CategoryList } from "./category-list.tsx";
import { DeleteTagDialog } from "./delete-tag-dialog.tsx";
import { NewCategoryDialog } from "./new-category-dialog.tsx";
import { useFlash } from "./use-flash.ts";

/** Lista de categorias e, ao tocar numa, o detalhe na mesma página. */
export function CategoriesBScreen({ store }: { store: Store }) {
  const { scenario, categories, dispatch, reader } = store;
  const [selectedId, setSelectedId] = useState(scenario === "sem-etiquetas" ? "c2" : scenario === "duplicado" || scenario === "excluir" ? "c1" : "");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(scenario === "excluir" ? "Vestuário" : "");
  const { flashed, flash } = useFlash();

  const selected = categories.find((c) => c.id === selectedId);
  const doomed = selected?.tags.find((t) => t.name === pendingDelete);

  return (
    <div className="flex flex-col gap-4">
      <p className="fine">{INTRO}</p>
      {reader && <Callout icon={<Icon name="eye" />} title="Seu acesso é somente para leitura." />}
      {selected ? (
        <CategoryDetail
          category={selected}
          categories={categories}
          dispatch={dispatch}
          reader={reader}
          flashed={flashed}
          flash={flash}
          startWithDuplicate={scenario === "duplicado"}
          onBack={() => setSelectedId("")}
          onAskDelete={(name) => setPendingDelete(name)}
        />
      ) : (
        <CategoryList categories={categories} reader={reader} onOpen={setSelectedId} onCreate={() => setCreating(true)} />
      )}
      <NewCategoryDialog
        open={creating}
        categories={categories}
        onSave={(name, essential) => {
          dispatch({ type: "addCategory", name, essential });
          setCreating(false);
        }}
        onClose={() => setCreating(false)}
      />
      <DeleteTagDialog
        target={selected && doomed ? { category: selected, tag: doomed } : null}
        onConfirm={() => {
          if (selected && doomed) dispatch({ type: "deleteTag", categoryId: selected.id, tagId: doomed.id });
          setPendingDelete("");
        }}
        onClose={() => setPendingDelete("")}
      />
    </div>
  );
}
