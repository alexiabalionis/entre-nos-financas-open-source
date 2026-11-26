import { NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "./src/server/csp";
import { MONTH_PATTERN } from "./app/lib/dates";
import { legacyViewPath } from "./app/shell/routes";
export function proxy(request: NextRequest) {
  // Links antigos /?view=… (favoritos, notificações) viram a rota nova, com
  // redirecionamento de verdade e mantendo ?month=. O navegador reaplica o
  // #fragmento original ao seguir o redirecionamento.
  const { pathname, searchParams } = request.nextUrl;
  const target =
    pathname === "/" ? legacyViewPath(searchParams.get("view")) : null;
  if (target) {
    const url = request.nextUrl.clone();
    const month = searchParams.get("month") ?? "";
    url.pathname = target;
    url.search = MONTH_PATTERN.test(month) ? "?month=" + month : "";
    return NextResponse.redirect(url);
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
// Todas as páginas recebem o CSP com nonce (a rota única "/" virou várias).
// Ficam de fora: API, assets do Next e arquivos públicos estáticos, que
// seguem só com o CSP estático de next.config.ts.
export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/|favicon\\.ico|sw\\.js|offline\\.html|icons/|manifest\\.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
