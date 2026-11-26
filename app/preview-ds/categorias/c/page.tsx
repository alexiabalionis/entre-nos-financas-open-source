"use client";
import { CategoriesFrame } from "../frame.tsx";
import { MovementsContext } from "./movements-context.tsx";

export default function CategoriasOpcaoC() {
  return (
    <CategoriesFrame title="Categorias a partir de Movimentos">
      {(store) => <MovementsContext key={store.scenario} store={store} />}
    </CategoriesFrame>
  );
}
