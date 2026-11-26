"use client";
import { CategoriesFrame } from "../frame.tsx";
import { CategoryScreen } from "./category-screen.tsx";

export default function CategoriasA() {
  return (
    <CategoriesFrame title="Categorias e etiquetas, opção A">
      {(store) => <CategoryScreen key={store.scenario} store={store} />}
    </CategoriesFrame>
  );
}
