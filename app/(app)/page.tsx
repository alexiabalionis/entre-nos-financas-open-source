import { MonthPage } from "../month/month-page";

// Links antigos `/?view=…` são redirecionados em proxy.ts, antes de renderizar.
export default function Page() {
  return <MonthPage />;
}
