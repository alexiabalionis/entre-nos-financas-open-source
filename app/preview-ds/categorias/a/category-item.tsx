"use client";
import { Button } from "../../../ds/index.ts";
import { Row } from "../../../ds/row.tsx";
import { StatusChip } from "../../../ds/status-chip.tsx";
import { Collapsible } from "../../../collapsible.tsx";
import { CategoryIcon } from "../../../family-categories.tsx";
import { categoryColor } from "../../../../src/domain/category-color.ts";
import { movementCount, tagCount, type Action, type Category, type Tag } from "../fixture.ts";
import { TagList } from "./tag-list.tsx";

/** Categoria como linha que abre ali mesmo e mostra as etiquetas. */
export function CategoryItem({
  category,
  open,
  reader,
  saved,
  initialDraft,
  dispatch,
  onOpenChange,
  onEdit,
  onAskDelete,
}: {
  category: Category;
  open: boolean;
  reader: boolean;
  saved: boolean;
  initialDraft: string;
  dispatch: (a: Action) => void;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onAskDelete: (tag: Tag) => void;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      summary={
        <Row
          icon={<CategoryIcon name={category.name} />}
          catColor={categoryColor(category.name)}
          title={category.name}
          sub={`${tagCount(category.tags.length)} · ${movementCount(category.movements)}`}
          trail={
            saved ? (
              <StatusChip tone="ok" label="Salvo" />
            ) : category.essential ? (
              <StatusChip label="Essencial" />
            ) : undefined
          }
        />
      }
    >
      <div className="flex flex-col gap-3">
        <TagList
          category={category}
          reader={reader}
          initialDraft={initialDraft}
          dispatch={dispatch}
          onAskDelete={onAskDelete}
        />
        {!reader && (
          <div className="family-actions">
            <Button variant="quiet" size="sm" onClick={onEdit}>
              Editar categoria
            </Button>
          </div>
        )}
      </div>
    </Collapsible>
  );
}
