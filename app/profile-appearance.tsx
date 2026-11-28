"use client";
import { Segmented } from "./ds/segmented";
import { Icon } from "./ds/icon";
import {
  ACCENT_PRESETS,
  resolveAccentPreset,
  type Preferences,
} from "../src/domain/preferences";

const THEMES: { value: Preferences["theme"]; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
  { value: "system", label: "Sistema" },
];

/** Modo claro/escuro e cor de destaque curada por pessoa. */
export function ProfileAppearance({
  theme,
  onTheme,
  accent,
  onAccent,
}: {
  theme: Preferences["theme"];
  onTheme: (theme: Preferences["theme"]) => void;
  accent?: string;
  onAccent?: (hex: string) => void;
}) {
  const activePreset = resolveAccentPreset(accent);

  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-ink">Aparência</p>
          <p className="m-0 text-xs text-muted">
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

      {onAccent ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-ink">Cor de destaque</p>
            <p className="m-0 text-xs text-muted">
              Personaliza os botões e o painel principal para você.
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Cor de destaque"
            className="flex flex-wrap items-center gap-2"
          >
            {ACCENT_PRESETS.map((preset) => {
              const selected = preset.id === activePreset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    document.documentElement.dataset.accent = preset.id;
                    onAccent(preset.hex);
                  }}
                  className={`ui-btn inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    selected
                      ? "border-accent bg-accent-soft text-accent-ink font-semibold"
                      : "border-border bg-surface text-muted hover:border-border-strong hover:text-ink"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="inline-flex size-4 items-center justify-center rounded-full text-white"
                    style={{ background: preset.swatch }}
                  >
                    {selected ? <Icon name="check" size={11} /> : null}
                  </span>
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
