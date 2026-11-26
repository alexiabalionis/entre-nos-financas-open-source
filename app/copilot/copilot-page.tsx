"use client";
import { CopilotScreen } from "./copilot-screen.tsx";
import { useSession } from "../session/session-context";
import { today } from "../lib/dates.ts";

/** Página /copiloto: o Copiloto busca os próprios dados; aqui só a sessão. */
export function CopilotPage() {
  const session = useSession();
  return (
    <CopilotScreen
      today={today()}
      hidden={session.hidden}
      reader={session.reader}
    />
  );
}
