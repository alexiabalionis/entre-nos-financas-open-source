"use client";
import { useEffect, useRef } from "react";
import { Button } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import { Row } from "../../../ds/row.tsx";
import { StatusChip } from "../../../ds/status-chip.tsx";
import { CategoryIcon } from "../../../family-categories";
import { categoryColor } from "../../../../src/domain/category-color.ts";
import { movementCount, tagCount, type Action, type Category, type Tag } from "../fixture.ts";
import { TagAdder } from "./tag-adder.tsx";
import { TagRow } from "./tag-row.tsx";

/** Uma categoria no Sheet: cabeçalho, etiquetas como chips e, em edição, linhas com ações. */
export function CategorySection({
  category,
  edit,
  dispatch,
  onEditCategory,
  onDeleteTag,
  draft,
  scrollTo,
}: {
  category: Category;
  edit: boolean;
  dispatch: (a: Action) => void;
  onEditCategory: () => void;
  onDeleteTag: (c: Category, t: Tag) => void;
  draft?: string;
  scrollTo?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ block: "nearest" });
  }, [scrollTo]);
  const empty = category.tags.length === 0;
  return (
    <div ref={ref}>
      <Panel>
        <Row
          icon={<CategoryIcon name={category.name} />}
          catColor={categoryColor(category.name)}
          title={category.name}
          sub={`${tagCount(category.tags.length)} · ${movementCount(category.movements)}`}
          trail={category.essential ? <StatusChip tone="ok" label="Essencial" /> : undefined}
        />
        {edit ? (
          <>
            <div>
              <Button variant="text" size="sm" onClick={onEditCategory} aria-label={`Editar categoria ${category.name}`}>
                Editar categoria
              </Button>
            </div>
            {empty ? (
              <p className="text-sm opacity-70">Esta categoria ainda não tem etiquetas. Crie a primeira abaixo.</p>
            ) : (
              <div className="ds-list list gap-0">
                {category.tags.map((t) => (
                  <TagRow key={t.id} category={category} tag={t} dispatch={dispatch} onDelete={(tag) => onDeleteTag(category, tag)} />
                ))}
              </div>
            )}
            <TagAdder category={category} dispatch={dispatch} initial={draft} />
          </>
        ) : empty ? (
          <p className="text-sm opacity-70">Sem etiquetas ainda.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {category.tags.map((t) => (
              <StatusChip key={t.id} ghost icon="" label={t.name} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
