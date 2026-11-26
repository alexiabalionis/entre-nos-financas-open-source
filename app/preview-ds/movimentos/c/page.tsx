"use client";
import { MovementsFrame } from "../frame.tsx";
import { ScreenC } from "./screen.tsx";

export default function MovimentosC() {
  return (
    <MovementsFrame title="Ajustar movimentos, opção C: na própria linha">
      {(store) => <ScreenC key={store.scenario} store={store} />}
    </MovementsFrame>
  );
}
