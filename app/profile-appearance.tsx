"use client";
import { Segmented } from "./ds/segmented";
import type { Preferences } from "../src/domain/preferences";

const THEMES: { value: Preferences["theme"]; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

/** Modo claro, escuro ou do sistema. */
export function ProfileAppearance({
  theme,
  onTheme,
}: {
  theme: Preferences["theme"];
  onTheme: (theme: Preferences["theme"]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-4">
      <div className="min-w-0">
        <p className="m-0 text-sm font-semibold">Aparência</p>
        <p className="m-0 text-xs text-base-content/60">
          Escolha o modo do aplicativo.
        </p>
      </div>
      <Segmented
        label="Aparência"
        value={theme}
        options={THEMES}
        onChange={onTheme}
      />
    </div>
  );
}
