"use client";
import { useState } from "react";
import { Button } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import { ProfileCard } from "../../../profile-card.tsx";
import type { Store } from "../frame.tsx";
import { INTRO, type Scenario } from "../fixture.ts";
import { CategoryDialog, type CategoryDialogTarget } from "./category-dialog.tsx";
import { CategoryItem } from "./category-item.tsx";
import { DeleteTagDialog } from "./delete-tag-dialog.tsx";
import { useFlash } from "./use-flash.ts";

/** Cada cenário já nasce mostrando o seu estado (categoria aberta, rascunho, confirmação). */
const OPEN_AT: Record<Scenario, string | null> = {
  normal: "c1",
  "sem-etiquetas": "c2",
  vazio: null,
  leitura: "c1",
  duplicado: "c1",
  excluir: "c1",
};

const flashKey = (name: string) => name.trim().toLocaleLowerCase("pt-BR");

/** Cartão "Categorias e etiquetas" do Nosso espaço, em acordeão. */
export function CategoryScreen({ store }: { store: Store }) {
  const { scenario, categories, dispatch, reader } = store;
  const [expanded, setExpanded] = useState(true);
  const [openId, setOpenId] = useState<string | null>(OPEN_AT[scenario]);
  const [dialog, setDialog] = useState<CategoryDialogTarget>(null);
  const [pending, setPending] = useState<{ categoryId: string; tagName: string } | null>(
    scenario === "excluir" ? { categoryId: "c1", tagName: "Vestuário" } : null,
  );
  const { flashed, flash } = useFlash();

  const pendingCategory = pending && categories.find((c) => c.id === pending.categoryId);
  const pendingTag = pendingCategory?.tags.find((t) => t.name === pending?.tagName);
  const target = pendingCategory && pendingTag ? { category: pendingCategory, tag: pendingTag } : null;

  return (
    <>
      <ProfileCard
        title="Categorias e etiquetas"
        description="Organize os gastos do casal"
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      >
        <Panel title="Categorias" meta={categories.length === 1 ? "1 categoria" : `${categories.length} categorias`}>
          <p className="fine">{INTRO}</p>
          {reader && <p className="fine">Seu acesso é somente para leitura.</p>}
          {categories.length === 0 && (
            <p className="fine">Você ainda não tem categorias. Crie a primeira para organizar os gastos.</p>
          )}
          {categories.map((c) => (
            <CategoryItem
              key={c.id}
              category={c}
              open={openId === c.id}
              reader={reader}
              saved={flashed === flashKey(c.name)}
              initialDraft={scenario === "duplicado" && c.id === "c1" ? "vestuário" : ""}
              dispatch={dispatch}
              onOpenChange={(o) => setOpenId(o ? c.id : openId === c.id ? null : openId)}
              onEdit={() => setDialog({ category: c })}
              onAskDelete={(t) => setPending({ categoryId: c.id, tagName: t.name })}
            />
          ))}
          {!reader && (
            <div className="family-actions">
              <Button variant={categories.length === 0 ? "primary" : "secondary"} icon="plus" onClick={() => setDialog({})}>
                {categories.length === 0 ? "Criar primeira categoria" : "Nova categoria"}
              </Button>
            </div>
          )}
        </Panel>
      </ProfileCard>
      <CategoryDialog
        target={dialog}
        categories={categories}
        onClose={() => setDialog(null)}
        onSave={(name, essential) => {
          if (dialog?.category) dispatch({ type: "editCategory", id: dialog.category.id, name, essential });
          else dispatch({ type: "addCategory", name, essential });
          flash(flashKey(name));
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
    </>
  );
}
