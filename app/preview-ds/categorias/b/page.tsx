"use client";
import { CategoriesFrame } from "../frame.tsx";
import { CategoriesBScreen } from "./categories-b-screen.tsx";

export default function CategoriasB() {
  return (
    <CategoriesFrame title="Categorias e etiquetas, opção B">
      {(store) => <CategoriesBScreen key={store.scenario} store={store} />}
    </CategoriesFrame>
  );
}
