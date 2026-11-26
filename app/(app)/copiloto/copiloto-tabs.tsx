"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Segmented } from "../../ds/index.ts";
import { FutureScreen } from "../../future/index.ts";
import { useSession } from "../../session/session-context";

type Tab = "futuro" | "simular" | "agora";
const TABS: { value: Tab; label: string }[] = [
  { value: "futuro", label: "Futuro" },
  { value: "simular", label: "Simular" },
  { value: "agora", label: "Agora" },
];

const TabContext = createContext<{ tab: Tab; pick: (t: Tab) => void }>({ tab: "futuro", pick: () => {} });

/**
 * O Futuro com a sessão. Futuro e Simular são a mesma tela em dois modos: o
 * componente fica montado entre as duas abas, então o rascunho não se perde.
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
 * Alterna entre Futuro (padrão), Simular e Agora (reservas e margem do mês, a
 * tela anterior). A aba fica na URL (?aba=simular|agora) para voltar ao mesmo lugar.
 */
export function CopilotoTabs({ future, now }: { future: ReactNode; now: ReactNode }) {
  const [tab, setTab] = useState<Tab>("futuro");
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("aba");
    if (q === "agora" || q === "simular") setTab(q);
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
      <div className="fut-tabs">
        <Segmented label="Parte do Copiloto" value={tab} options={TABS} onChange={pick} />
      </div>
      {tab === "agora" ? now : future}
    </TabContext.Provider>
  );
}
