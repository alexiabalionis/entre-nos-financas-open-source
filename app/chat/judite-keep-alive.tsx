"use client";
import { useState } from "react";
import { HelpPanel } from "../family-chat";
import { RecordMovementDialog } from "../dialogs/record-movement-dialog";
import { ActionBanner } from "../shell/action-banner";
import { useSession } from "../session/session-context";
import { useAction } from "../hooks/use-action.ts";
import { monthCache } from "../hooks/use-month-data.ts";
import { currentMonth } from "../lib/dates.ts";

/**
 * Judite fica montada o tempo todo (escondida fora de /judite). O rascunho, a
 * conversa aberta, a posição de rolagem e uma resposta em andamento moram no
 * HelpPanel; desmontar a página cancelaria o pedido em voo (o cleanup do
 * HelpPanel aborta). O shell só decide `active` pela rota e não conhece nada
 * do estado do chat. O diálogo "registrar movimento" aberto pela Judite
 * também é dela.
 */
export function JuditeKeepAlive({ active }: { active: boolean }) {
  const session = useSession();
  const action = useAction();
  const [recording, setRecording] = useState(false);
  const month = currentMonth();
  return (
    <div className="family-chat-slot" hidden={!active}>
      <ActionBanner error={action.error} notice={action.notice} />
      <HelpPanel
        month={month}
        currency="BRL"
        hidden={session.hidden}
        record={() => setRecording(true)}
        // Sem tela de mês montada aqui: marca o cache para a próxima tela rebuscar.
        refresh={async () => monthCache.markStale()}
        reader={session.reader}
        active={active}
      />
      <RecordMovementDialog
        open={recording}
        initialKind="expense"
        month={month}
        action={action}
        onClose={() => setRecording(false)}
        onSaved={() => monthCache.markStale()}
      />
    </div>
  );
}
