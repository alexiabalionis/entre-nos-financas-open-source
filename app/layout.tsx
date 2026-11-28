import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { headers } from "next/headers";
import "./styles.css";

/** Fontes do design system. DM Sans no texto, Space Grotesk nos números.
 *  Expostas como CSS vars (--family-font-sans / --family-font-numeric) e lidas
 *  pelo family.css; next/font evita FOUT e hospeda localmente (sem @import). */
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--family-font-sans",
});
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--family-font-numeric",
});
export const metadata: Metadata = {
  title: "Entre Nós · Finanças da família",
  description: "Nosso planejamento, nossas contas e nossos planos.",
  applicationName: "Entre Nós",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Entre Nós" },
  icons: {
    icon: [
      { url: "/icons/icon-192-v3.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon-v3.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#111117" },
  ],
};
/** Aplica o tema e o acento salvos antes da primeira pintura (sem ele, quem usa
 *  "claro" num aparelho em modo escuro via o tema escuro piscar até o React carregar).
 *  O app-shell grava a preferência nestas chaves sempre que aplica tema/acento. */
const THEME_BOOT =
  'try{var t=localStorage.getItem("entre-nos-theme-v1");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;var a=localStorage.getItem("entre-nos-accent-v1");if(a==="roxo"||a==="esmeralda"||a==="oceano"||a==="ameixa")document.documentElement.dataset.accent=a}catch(e){}';

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: ferramentas do navegador (live view, zoom de
    // texto, extensões) injetam atributos em <html>/<body> antes do React
    // carregar. Só ignora atributos destas duas tags, não o conteúdo.
    <html
      lang="pt-BR"
      className={`${dmSans.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
