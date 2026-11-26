"use client";
import { CategoriesFrame } from "../frame.tsx";
import { CategoriesDScreen } from "./categories-d-screen.tsx";

export default function CategoriasD() {
  return (
    <CategoriesFrame title="Categorias e etiquetas, opção D">
      {(store) => <CategoriesDScreen key={store.scenario} store={store} />}
    </CategoriesFrame>
  );
}
