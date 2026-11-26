"use client";
import { Select } from "../../../ds/select.tsx";
import { useState } from "react";
import { Panel } from "../../../ds/panel.tsx";
import { Field } from "../../../field.tsx";
import type { Action, Category } from "../fixture.ts";
import { TagCombobox } from "./tag-combobox.tsx";

/**
 * Simula o diálogo "Categorizar transação" de app/family-movements.tsx (mesmo
 * select de Categoria) com a mesma caixa de etiquetas em modo de escolha única.
 */
export function MovementContext({ categories, dispatch }: { categories: Category[]; dispatch: (a: Action) => void }) {
  const [categoryId, setCategoryId] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const category = categories.find((c) => c.id === categoryId) ?? categories[0];
  const chosen = category?.tags.find((t) => t.name === picked);

  return (
    <Panel title="No movimento (fase 3, só para ver o mesmo campo em uso)">
      <p className="ds-caption fine">
        Aqui a caixa escolhe uma etiqueta para este movimento. O x tira a etiqueta do movimento e não a exclui da
        categoria. Para mudar o nome, use o lápis na lista.
      </p>
      {category ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Pix loja do centro</p>
          <Field label="Categoria">
            <Select
              value={category.id}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPicked(null);
              }}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <TagCombobox
            key={category.id}
            label="Etiqueta deste movimento"
            placeholder="Escolher etiqueta"
            tags={category.tags}
            chips={chosen ? [chosen] : []}
            onRemoveChip={() => setPicked(null)}
            removeLabel={(name) => `Tirar etiqueta ${name} deste movimento`}
            onPick={setPicked}
            onCreate={(name) => dispatch({ type: "addTag", categoryId: category.id, name })}
            onRename={(t, name) => {
              dispatch({ type: "renameTag", categoryId: category.id, tagId: t.id, name });
              if (picked === t.name) setPicked(name.trim());
            }}
          />
        </div>
      ) : (
        <p className="fine">Crie uma categoria para poder categorizar movimentos.</p>
      )}
    </Panel>
  );
}
