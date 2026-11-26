"use client";
import { useState, type FormEvent } from "react";
import { Button, Icon, Sheet } from "../../../ds/index.ts";
import { Callout } from "../../../ds/callout.tsx";
import { FlatPanelsProvider } from "../../../ds/panel.tsx";
import { FamilyDialog } from "../../../dialogs/family-dialog";
import { deleteMessage, INTRO, type Category, type Scenario, type Tag } from "../fixture.ts";
import type { Store } from "../frame.tsx";
import { CategoryForm } from "./category-form.tsx";
import { CategorySection } from "./category-section.tsx";

type View = { kind: "list" } | { kind: "new" } | { kind: "edit"; id: string };
type Pending = { categoryId: string; tagName: string };

const EDITING: Scenario[] = ["sem-etiquetas", "duplicado", "excluir"];

/** Sheet de gestão: categorias em seções, modo de edição e formulário de categoria no mesmo Sheet. */
export function ManageSheet({ store, open, onClose }: { store: Store; open: boolean; onClose: () => void }) {
  const { scenario, categories, dispatch, reader } = store;
  const [view, setView] = useState<View>({ kind: "list" });
  const [edit, setEdit] = useState(EDITING.includes(scenario) && !reader);
  const [pending, setPending] = useState<Pending | null>(
    scenario === "excluir" ? { categoryId: "c1", tagName: "Vestuário" } : null,
  );

  const pendingCategory = pending ? categories.find((c) => c.id === pending.categoryId) : undefined;
  const pendingTag = pendingCategory?.tags.find((t) => t.name === pending?.tagName);

  const askDelete = (c: Category, t: Tag) => {
    if (t.uses === 0) dispatch({ type: "deleteTag", categoryId: c.id, tagId: t.id });
    else setPending({ categoryId: c.id, tagName: t.name });
  };
  const confirmDelete = (e: FormEvent) => {
    e.preventDefault();
    if (pendingCategory && pendingTag) dispatch({ type: "deleteTag", categoryId: pendingCategory.id, tagId: pendingTag.id });
    setPending(null);
  };
  const back = () => setView({ kind: "list" });
  const editing = view.kind === "edit" ? categories.find((c) => c.id === view.id) : undefined;

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={view.kind === "new" ? "Nova categoria" : view.kind === "edit" ? "Editar categoria" : "Categorias e etiquetas"}
        footer={
          view.kind === "list" && !reader ? (
            <Button variant="primary" icon="plus" onClick={() => setView({ kind: "new" })}>
              Nova categoria
            </Button>
          ) : undefined
        }
      >
        {view.kind === "list" ? (
          <>
            <p className="text-sm opacity-70">{INTRO}</p>
            {reader ? (
              <Callout icon={<Icon name="eye" />} title="Somente leitura">
                Seu acesso é somente para leitura.
              </Callout>
            ) : categories.length > 0 ? (
              <div>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={() => setEdit((v) => !v)}
                  aria-pressed={edit}
                  icon={<Icon name={edit ? "check" : "layers"} size={16} />}
                >
                  {edit ? "Concluir" : "Editar"}
                </Button>
              </div>
            ) : null}
            {categories.length === 0 ? (
              <Callout icon={<Icon name="layers" />} title="Nenhuma categoria ainda">
                {reader
                  ? "Quando alguém criar categorias, elas aparecem aqui."
                  : "Crie a primeira categoria para organizar seus gastos. Depois você pode separar por etiquetas."}
              </Callout>
            ) : (
              <FlatPanelsProvider>
                <div className="grid gap-4">
                  {categories.map((c) => (
                    <CategorySection
                      key={c.id}
                      category={c}
                      edit={edit && !reader}
                      dispatch={dispatch}
                      onEditCategory={() => setView({ kind: "edit", id: c.id })}
                      onDeleteTag={askDelete}
                      draft={scenario === "duplicado" && c.name === "Compras pessoais" ? "vestuário" : undefined}
                      scrollTo={(scenario === "sem-etiquetas" && c.name === "Supermercado e feira") || (scenario === "duplicado" && c.name === "Compras pessoais")}
                    />
                  ))}
                </div>
              </FlatPanelsProvider>
            )}
          </>
        ) : (
          <CategoryForm key={view.kind === "edit" ? view.id : "new"} category={editing} categories={categories} dispatch={dispatch} onDone={back} />
        )}
      </Sheet>
      <FamilyDialog open={Boolean(pendingTag)} title="Excluir etiqueta?" busy={false} error="" onClose={() => setPending(null)}>
        {pendingCategory && pendingTag ? (
          <form onSubmit={confirmDelete} className="grid gap-4">
            <p>{deleteMessage(pendingCategory, pendingTag)}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary">
                Excluir etiqueta
              </Button>
              <Button variant="quiet" onClick={() => setPending(null)}>
                Manter
              </Button>
            </div>
          </form>
        ) : null}
      </FamilyDialog>
    </>
  );
}
