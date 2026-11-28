"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Segmented } from "../../ds/index.ts";
import { FutureScreen } from "../../future/index.ts";
import { useSession } from "../../session/session-context";

type Tab = "futuro" | "simular";
const TABS: { value: Tab; label: string }[] = [
  { value: "futuro", label: "Visão geral" },
  { value: "simular", label: "Simular" },
];

const TabContext = createContext<{ tab: Tab; pick: (t: Tab) => void }>({
  tab: "futuro",
  pick: () => {},
});

/**
 * O Futuro com a sessão. Futuro e Simular dividem o mesmo rascunho.
 */
export function FutureSlot() {
  const session = useSession();
  const { tab, pick } = useContext(TabContext);
  return (
    <FutureScreen
      hidden={session.hidden}
      reader={session.reader}
      mode={tab === "simular" ? "simular" : "ver"}
      onMode={(m) => pick(m === "simular" ? "simular" : "futuro")}
    />
  );
}

/**
 * Cabeçalho do Copiloto com alternância em 2 modos: Futuro e Simular.
 * Links legados com `?aba=agora` redirecionam suavemente para Futuro (#reservas).
 */
export function CopilotoTabs({ future }: { future: ReactNode; now?: ReactNode }) {
  const [tab, setTab] = useState<Tab>("futuro");

  useEffect(() => {
    const url = new URL(location.href);
    const q = url.searchParams.get("aba");
    if (q === "simular") {
      setTab("simular");
    } else if (q === "agora") {
      setTab("futuro");
      url.searchParams.delete("aba");
      history.replaceState(history.state, "", url);
      requestAnimationFrame(() => {
        document.getElementById("reservas")?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, []);

  const pick = (t: Tab) => {
    setTab(t);
    const url = new URL(location.href);
    if (t === "futuro") url.searchParams.delete("aba");
    else url.searchParams.set("aba", t);
    history.replaceState(history.state, "", url);
    window.scrollTo({ top: 0 });
  };

  return (
    <TabContext.Provider value={{ tab, pick }}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
            Planos
          </h1>
          <p className="m-0 mt-0.5 text-sm text-muted">
            Metas, reservas e simulações antes de decidir.
          </p>
        </div>
        <Segmented label="Parte do Copiloto" value={tab} options={TABS} onChange={pick} />
      </div>
      {future}
    </TabContext.Provider>
  );
}
