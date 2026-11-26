import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: {
    agentUpgrade: "security",
  },
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  // Permite validar um build de produção sem sobrescrever o .next do dev server
  // (NEXT_DIST_DIR=.next-check). Sem a variável, nada muda.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Em dev, acessar o server por um host não-localhost (IP/hostname Tailscale,
  // para abrir no celular) faz o Next 16 tratar os assets internos (/_next/...)
  // como cross-origin e bloqueá-los — o bootstrap do cliente não carrega e a
  // app fica em "Carregando…". Liberar os hosts de dev resolve. Só afeta dev.
  allowedDevOrigins: [
    "100.126.165.4",
    "macbook-pro-de-alxia.tail66329c.ts.net",
  ],
  outputFileTracingIncludes: {
    "/api/*": ["./db/migrations/*.sql"],
    "/*": ["./node_modules/next/dist/lib/framework/**/*.js"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./data/**/*",
      "./work/**/*",
      "./docs/**/*",
      "./ios/**/*",
      "./tests/**/*",
      "./tests-js/**/*",
      "./*.pdf",
      "./*.xlsx",
      "./*.csv",
      "./*.ofx",
    ],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          ...(process.env.APP_ORIGIN?.startsWith("https://")
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'" +
              // Em dev, o Next 16 + Turbopack injeta scripts inline (inclusive o
              // self.__next_r que inicia o bootstrap do cliente). Sem
              // 'unsafe-inline' o browser bloqueia esse inline e a app não
              // hidrata ("Carregando…" eterno). Só em dev — produção segue sem
              // unsafe-inline/eval. Mesmo padrão já usado para 'unsafe-eval'.
              (process.env.NODE_ENV === "development"
                ? " 'unsafe-eval' 'unsafe-inline'"
                : "") +
              "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'" +
              // Em dev, o HMR do Turbopack abre um WebSocket em /_next/hmr;
              // liberar ws:/wss: no connect-src evita que a CSP o bloqueie.
              (process.env.NODE_ENV === "development" ? " ws: wss:" : "") +
              "; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
