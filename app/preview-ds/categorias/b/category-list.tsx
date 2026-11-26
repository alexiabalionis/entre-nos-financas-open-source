"use client";
import { Button, IconButton } from "../../../ds/index.ts";
import { Panel } from "../../../ds/panel.tsx";
import { RowList } from "../../../ds/row-list.tsx";
import { StatusChip } from "../../../ds/status-chip.tsx";
import { CategoryIcon } from "../../../family-categories.tsx";
import { categoryColor } from "../../../../src/domain/category-color.ts";
import { movementCount, tagCount, type Category } from "../fixture.ts";

/** Primeiro nível: todas as categorias, cada uma com chevron para abrir. */
export function CategoryList({
  categories,
  reader,
  onOpen,
  onCreate,
}: {
  categories: Category[];
  reader: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  if (categories.length === 0)
    return (
      <Panel title="Categorias">
        <p className="fine">Você ainda não tem categorias. Crie a primeira para organizar seus gastos.</p>
        {!reader && (
          <Button variant="primary" icon="plus" onClick={onCreate}>
            Criar primeira categoria
          </Button>
        )}
      </Panel>
    );
  return (
    <Panel title="Categorias" meta={`${categories.length}`}>
      <RowList
        rows={categories.map((c) => ({
          icon: <CategoryIcon name={c.name} />,
          catColor: categoryColor(c.name),
          title: c.name,
          sub: `${tagCount(c.tags.length)} · ${movementCount(c.movements)}`,
          trail: (
            <span className="flex items-center gap-1">
              {c.essential && <StatusChip label="Essencial" tone="accent" />}
              <IconButton icon="right" label={`Abrir ${c.name}`} onClick={() => onOpen(c.id)} />
            </span>
          ),
        }))}
      />
      {!reader && (
        <Button icon="plus" onClick={onCreate}>
          Nova categoria
        </Button>
      )}
    </Panel>
  );
}
