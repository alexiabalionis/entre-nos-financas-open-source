"use client";
import { Button, Icon } from "../../../ds/index.ts";
import type { Action, Category } from "../fixture.ts";
import { CategoryFormPanel } from "./category-form-panel.tsx";
import { TagListPanel } from "./tag-list-panel.tsx";

/** Segundo nível: a categoria escolhida, com seus dados e suas etiquetas. */
export function CategoryDetail({
  category,
  categories,
  dispatch,
  reader,
  flashed,
  flash,
  startWithDuplicate,
  onBack,
  onAskDelete,
}: {
  category: Category;
  categories: Category[];
  dispatch: (a: Action) => void;
  reader: boolean;
  flashed: string;
  flash: (key: string) => void;
  startWithDuplicate: boolean;
  onBack: () => void;
  onAskDelete: (tagName: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="text" onClick={onBack}>
          <Icon name="left" />
          Voltar
        </Button>
      </div>
      <CategoryFormPanel
        key={category.id}
        category={category}
        siblings={categories.filter((c) => c.id !== category.id).map((c) => c.name)}
        reader={reader}
        saved={flashed === `cat:${category.id}`}
        onSave={(name, essential) => {
          dispatch({ type: "editCategory", id: category.id, name, essential });
          flash(`cat:${category.id}`);
        }}
      />
      <TagListPanel
        key={category.id}
        category={category}
        reader={reader}
        flashed={flashed}
        flash={flash}
        dispatch={dispatch}
        startWithDuplicate={startWithDuplicate}
        onAskDelete={onAskDelete}
      />
    </div>
  );
}
