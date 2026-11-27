"use client";
import { useState } from "react";
import { Button } from "../../ds/index.ts";
import { Panel } from "../../ds/panel.tsx";
import { CategoryBlock } from "./category-block.tsx";
import {
  CategoryDialog,
  type CategoryDialogTarget,
} from "./category-dialog.tsx";
import { DeleteTagDialog, type DeleteTarget } from "./delete-tag-dialog.tsx";
import {
  INTRO,
  categoryCount,
  type CategoryTag,
  type SpaceCategory,
} from "./categories-model.ts";
import { useCategoryActions } from "./use-category-actions.ts";

/** Gestão de categorias e etiquetas do Nosso espaço, ligada às rotas do servidor. */
export function CategoriesPanel({
  categories,
  reader,
  refresh,
}: {
  categories: SpaceCategory[];
  reader: boolean;
  refresh: () => Promise<void>;
}) {
  const actions = useCategoryActions(refresh);
  const [dialog, setDialog] = useState<CategoryDialogTarget>(null);
  const [pending, setPending] = useState<{
    categoryId: string;
    tagId: string;
  } | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [rowError, setRowError] = useState("");

  const pendingCategory = pending
    ? categories.find((c) => c.id === pending.categoryId)
    : undefined;
  const pendingTag = pendingCategory?.tags.find((t) => t.id === pending?.tagId);
  const target: DeleteTarget =
    pendingCategory && pendingTag
      ? { category: pendingCategory, tag: pendingTag }
      : null;

  const closeDialog = () => {
    setDialog(null);
    setDialogError("");
  };
  const closePending = () => {
    setPending(null);
    setDialogError("");
  };

  async function askDelete(category: SpaceCategory, tag: CategoryTag) {
    setRowError("");
    if (tag.uses > 0) {
      setPending({ categoryId: category.id, tagId: tag.id });
      return;
    }
    setRowError(await actions.deleteTag(tag.id));
  }

  async function saveCategory(name: string, essential: boolean) {
    const message = await actions.saveCategory({
      id: dialog?.category?.id,
      name,
      essential,
    });
    if (message) setDialogError(message);
    else closeDialog();
  }

  async function confirmDelete() {
    if (!target) return;
    const message = await actions.deleteTag(target.tag.id);
    if (message) setDialogError(message);
    else closePending();
  }

  return (
    <>
      <Panel title="Categorias" meta={categoryCount(categories.length)} className="mb-0">
        <p className="ds-caption">{INTRO}</p>
        {reader ? (
          <p className="ds-caption">Seu acesso é somente para leitura.</p>
        ) : null}
        {categories.length === 0 ? (
          <p className="ds-caption">
            Você ainda não tem categorias. Crie a primeira para organizar os
            gastos.
          </p>
        ) : null}
        {rowError ? (
          <p
            className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
            role="alert"
          >
            {rowError}
          </p>
        ) : null}
        {reader ? null : (
          <div>
            <Button
              variant="primary"
              icon="plus"
              disabled={actions.busy}
              onClick={() => setDialog({})}
            >
              {categories.length === 0
                ? "Criar primeira categoria"
                : "Nova categoria"}
            </Button>
          </div>
        )}
        {categories.map((c) => (
          <CategoryBlock
            key={c.id}
            category={c}
            reader={reader}
            busy={actions.busy}
            flashId={actions.flashId}
            onEdit={() => setDialog({ category: c })}
            onCreateTag={(name) => actions.createTag(c.id, name)}
            onRenameTag={(tag, name) => actions.renameTag(tag.id, name)}
            onAskDelete={(tag) => void askDelete(c, tag)}
          />
        ))}
      </Panel>
      <CategoryDialog
        target={dialog}
        categories={categories}
        busy={actions.busy}
        error={dialogError}
        onClose={closeDialog}
        onSave={(name, essential) => void saveCategory(name, essential)}
      />
      <DeleteTagDialog
        target={target}
        busy={actions.busy}
        error={dialogError}
        onClose={closePending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
