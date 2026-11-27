"use client";
import type { CSSProperties } from "react";
import { ChipField, IconButton } from "../../ds/index.ts";
import { IconBadge } from "../../ds/icon-badge.tsx";
import { StatusChip } from "../../ds/status-chip.tsx";
import { CategoryIcon } from "../../family-categories.tsx";
import { categoryColor } from "../../../src/domain/category-color.ts";
import {
  TAG_TEXT,
  nameError,
  tagCount,
  tagCreateLabel,
  tagRemoveLabel,
  tagRenameLabel,
  toItems,
  type CategoryTag,
  type SpaceCategory,
} from "./categories-model.ts";

/** Uma categoria: linha do DS e, logo abaixo, a caixa com as etiquetas como chips. */
export function CategoryBlock({
  category,
  reader,
  busy,
  flashId,
  onEdit,
  onCreateTag,
  onRenameTag,
  onAskDelete,
}: {
  category: SpaceCategory;
  reader: boolean;
  busy: boolean;
  /** Etiqueta recém-salva, para o chip mostrar o destaque. */
  flashId: string | null;
  onEdit: () => void;
  onCreateTag: (name: string) => Promise<string>;
  onRenameTag: (tag: CategoryTag, name: string) => Promise<string>;
  onAskDelete: (tag: CategoryTag) => void;
}) {
  const items = toItems(category.tags);
  const color = categoryColor(category.name);
  const byId = (id: string) => category.tags.find((t) => t.id === id);
  return (
    <section className="rounded-2xl border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-48 items-center gap-3 sm:w-64">
          <IconBadge
            size="lg"
            icon={<CategoryIcon name={category.name} />}
            data-cat=""
            style={{ "--tone": color, "--badge-color": color } as CSSProperties}
          />
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold leading-snug text-ink">
              {category.name}
            </h3>
            <p className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {tagCount(category.tags.length)}
              {category.essential ? (
                <StatusChip tone="ok" label="Essencial" />
              ) : null}
            </p>
          </div>
        </div>
        <div className="min-w-60 flex-1">
          <ChipField
            label={`Etiquetas de ${category.name}`}
            items={items}
            chips={items}
            text={TAG_TEXT}
            placeholder="Adicionar etiqueta"
            createLabel={tagCreateLabel}
            removeLabel={tagRemoveLabel}
            renameLabel={tagRenameLabel}
            readOnly={reader}
            busy={busy}
            floating
            flashId={flashId}
            validate={(name, exceptId) =>
              nameError(
                name,
                category.tags
                  .filter((t) => t.id !== exceptId)
                  .map((t) => t.name),
                "tag",
              )
            }
            onCreate={onCreateTag}
            onRename={(item, name) => {
              const tag = byId(item.id);
              return tag ? onRenameTag(tag, name) : "";
            }}
            onRemoveChip={(item) => {
              const tag = byId(item.id);
              if (tag) onAskDelete(tag);
            }}
          />
        </div>
        {reader ? null : (
          <IconButton
            icon="edit"
            size="sm"
            label={`Editar categoria ${category.name}`}
            disabled={busy}
            onClick={onEdit}
          />
        )}
      </div>
    </section>
  );
}
