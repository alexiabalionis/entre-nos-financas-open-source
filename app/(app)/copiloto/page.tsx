import { CopilotPage } from "../../copilot/copilot-page";
import { FutureScope } from "../../future/future-scope";
import { CopilotoTabs, FutureSlot } from "./copiloto-tabs";

/** /copiloto: o Futuro (nova tela, com a fonte própria) e o Agora (tela anterior, intacta). */
export default function Page() {
  return (
    <CopilotoTabs
      future={
        <FutureScope>
          <FutureSlot />
        </FutureScope>
      }
      now={<CopilotPage />}
    />
  );
}
