"use client";
import { MovementsFrame } from "../frame.tsx";
import { ScreenA } from "./screen.tsx";

export default function MovimentosA() {
  return (
    <MovementsFrame title="Ajustar movimentos, opção A: pelo menu">
      {(store) => <ScreenA key={store.scenario} store={store} />}
    </MovementsFrame>
  );
}
