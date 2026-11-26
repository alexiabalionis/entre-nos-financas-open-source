"use client";
import { MovementsFrame } from "../frame.tsx";
import { ScreenB } from "./screen.tsx";

export default function MovimentosB() {
  return (
    <MovementsFrame title="Ajustar movimentos, opção B: folha de ajuste">
      {(store) => <ScreenB key={store.scenario} store={store} />}
    </MovementsFrame>
  );
}
