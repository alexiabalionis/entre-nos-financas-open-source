import { FutureScope } from "../../future/future-scope";
import { CopilotoTabs, FutureSlot } from "./copiloto-tabs";

/** /copiloto: unificado em 2 modos (Futuro + Simular), com Reservas integradas. */
export default function Page() {
  return (
    <CopilotoTabs
      future={
        <FutureScope>
          <FutureSlot />
        </FutureScope>
      }
    />
  );
}
