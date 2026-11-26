"use client";
// Protótipos do Copiloto (gestão do futuro). Dados fictícios, nada é gravado:
// o estado vive em memória e "Salvar como plano" só troca o plano de referência
// do protótipo. As quatro alternativas compartilham o mesmo motor (engine.ts).
import { useEffect, useState } from "react";
import { EditorialTimeline } from "./a-editorial.tsx";
import { FinancialJourney } from "./b-journey.tsx";
import { FutureSimulator } from "./c-simulator.tsx";
import { BoldStudio } from "./d-studio.tsx";
import { CopilotProvider, Icon, useCopilot } from "./kit.tsx";

const VARIANTS = [
  { id: "a", label: "Editorial Timeline", short: "A" },
  { id: "b", label: "Financial Journey", short: "B" },
  { id: "c", label: "Future Simulator", short: "C" },
  { id: "d", label: "Bold Future Studio", short: "D" },
  { id: "ab", label: "Editorial + Jornada", short: "A+B" },
] as const;
type VariantId = (typeof VARIANTS)[number]["id"];

export default function CopilotPrototypes() {
  return (
    <CopilotProvider>
      <Shell />
    </CopilotProvider>
  );
}

function Shell() {
  const s = useCopilot();
  const [v, setV] = useState<VariantId>("a");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("v");
    if (q && VARIANTS.some((x) => x.id === q)) setV(q as VariantId);
    const t = document.documentElement.dataset.theme;
    if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches)) setTheme("dark");
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const pick = (id: VariantId) => {
    setV(id);
    const url = new URL(location.href);
    url.searchParams.set("v", id);
    history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="cf" data-variant={v}>
      <div className="cf-proto-bar" role="navigation" aria-label="Alternativas de protótipo">
        <span className="cf-proto-name">Protótipos · dados fictícios</span>
        <div className="cf-proto-tabs">
          {VARIANTS.map((x) => (
            <button key={x.id} type="button" aria-current={v === x.id ? "page" : undefined} onClick={() => pick(x.id)}>
              <b>{x.short}</b>
              <span>{x.label}</span>
            </button>
          ))}
        </div>
        <div className="cf-proto-tools">
          <button type="button" className="cf-icon-btn" onClick={s.reset} aria-label="Recomeçar com os dados iniciais" title="Recomeçar com os dados iniciais">
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="cf-icon-btn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} />
          </button>
        </div>
      </div>
      <main className="cf-stage">
        {v === "a" ? <EditorialTimeline /> : null}
        {v === "b" ? <FinancialJourney /> : null}
        {v === "c" ? <FutureSimulator /> : null}
        {v === "d" ? <BoldStudio /> : null}
        {v === "ab" ? <EditorialTimeline journey /> : null}
      </main>
    </div>
  );
}
