"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import { ProfileCard } from "../../../profile-card.tsx";
import { INTRO, type Category, type Tag } from "../fixture.ts";
import type { Store } from "../frame.tsx";
import { CategoryBlock } from "./category-block.tsx";
import { CategoryDialog, type CategoryDialogTarget } from "./category-dialog.tsx";
import { DeleteTagDialog, type DeleteTarget } from "./delete-tag-dialog.tsx";
import { MovementContext } from "./movement-context.tsx";
import { norm } from "./tag-search.ts";
import { useFlashKey } from "./use-flash-key.ts";

const count = (n: number) => (n === 1 ? "1 categoria" : `${n} categorias`);

/** Cartão "Categorias e etiquetas" da opção D, mais a simulação do mesmo campo em Movimentos. */
export function CategoriesDScreen({ store }: { store: Store }) {
  const { scenario, categories, dispatch, reader } = store;
  const [expanded, setExpanded] = useState(true);
  const [dialog, setDialog] = useState<CategoryDialogTarget>(null);
  // Guarda só ids: ao trocar de cenário a tela remonta antes de as categorias novas chegarem.
  const [pending, setPending] = useState<{ categoryId: string; tagId?: string; tagName: string } | null>(
    scenario === "excluir" ? { categoryId: "c1", tagName: "Vestuário" } : null,
  );
  const [flashed, flash] = useFlashKey();

  const pendingCategory = pending ? categories.find((c) => c.id === pending.categoryId) : undefined;
  const pendingTag = pendingCategory?.tags.find((t) => (pending?.tagId ? t.id === pending.tagId : t.name === pending?.tagName));
  const target: DeleteTarget = pendingCategory && pendingTag ? { category: pendingCategory, tag: pendingTag } : null;

  const askDelete = (category: Category, tag: Tag) => {
    if (tag.uses === 0) dispatch({ type: "deleteTag", categoryId: category.id, tagId: tag.id });
    else setPending({ categoryId: category.id, tagId: tag.id, tagName: tag.name });
  };

  return (
    <div className="flex flex-col gap-4">
      <ProfileCard
        title="Categorias e etiquetas"
        description="Organize os gastos do casal"
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      >
        <Panel title="Categorias" meta={count(categories.length)}>
          <p className="ds-caption fine">{INTRO}</p>
          {reader ? <p className="fine">Seu acesso é somente para leitura.</p> : null}
          {categories.length === 0 ? (
            <p className="fine">Você ainda não tem categorias. Crie a primeira para organizar os gastos.</p>
          ) : null}
          {reader ? null : (
            <div>
              <Button variant={categories.length === 0 ? "primary" : "secondary"} icon="plus" onClick={() => setDialog({})}>
                {categories.length === 0 ? "Criar primeira categoria" : "Nova categoria"}
              </Button>
            </div>
          )}
          {categories.map((c) => (
            <CategoryBlock
              key={c.id}
              category={c}
              reader={reader}
              flashKey={flashed}
              initialOpen={(scenario === "sem-etiquetas" && c.id === "c2") || (scenario === "duplicado" && c.id === "c1")}
              placeholder="Adicionar etiqueta"
              initialQuery={scenario === "duplicado" && c.id === "c1" ? "vestuário" : undefined}
              dispatch={dispatch}
              onFlash={(name) => flash(norm(name))}
              onEdit={() => setDialog({ category: c })}
              onAskDelete={askDelete}
            />
          ))}
        </Panel>
      </ProfileCard>
      <MovementContext categories={categories} dispatch={dispatch} />
      <CategoryDialog
        target={dialog}
        categories={categories}
        onClose={() => setDialog(null)}
        onSave={(name, essential) => {
          if (dialog?.category) dispatch({ type: "editCategory", id: dialog.category.id, name, essential });
          else dispatch({ type: "addCategory", name, essential });
          setDialog(null);
        }}
      />
      <DeleteTagDialog
        target={target}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (target) dispatch({ type: "deleteTag", categoryId: target.category.id, tagId: target.tag.id });
          setPending(null);
        }}
      />
    </div>
  );
}
