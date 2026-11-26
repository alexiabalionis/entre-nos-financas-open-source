"use client";
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { Segmented } from "../../ds/index.ts";
import { Select } from "../../ds/select.tsx";
import css from "../futuro/showcase.module.css";
import { initialRows, reducer, SCENARIOS, type Action, type Row, type Scenario } from "./fixture.ts";

export type Store = { scenario: Scenario; rows: Row[]; dispatch: (a: Action) => void; reader: boolean };

/**
 * Moldura das três opções: cenário, tema e largura de celular. Mesma raiz
 * .family-app e mesmo module da vitrine de categorias; nada de estilo novo.
 */
export function MovementsFrame({ title, children }: { title: string; children: (s: Store) => ReactNode }) {
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [rows, dispatch] = useReducer(reducer, "normal", initialRows);
  useEffect(() => dispatch({ type: "reset", rows: initialRows(scenario) }), [scenario]);
  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = theme;
    return () => {
      if (before === undefined) delete root.dataset.theme;
      else root.dataset.theme = before;
    };
  }, [theme]);
  return (
    <main className={`family-app ${css.page}`}>
      <h1 className={css.title}>{title}</h1>
      <p className={css.note}>Protótipo com dados fictícios, sem rede. As alterações ficam só nesta página.</p>
      <div className={css.controls} role="group" aria-label="Controles do protótipo">
        <label className="field fieldset">
          <span className="fieldset-legend">Tela do protótipo</span>
          <Select size="sm" value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
            {SCENARIOS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <Segmented
          label="Tema"
          size="sm"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Claro" },
            { value: "dark", label: "Escuro" },
          ]}
        />
      </div>
      <div className="mx-auto w-full max-w-[420px]">
        {children({ scenario, rows, dispatch, reader: scenario === "leitura" })}
      </div>
    </main>
  );
}
