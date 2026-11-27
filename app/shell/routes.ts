/**
 * Rotas do app: título, item da barra de baixo e mapa dos links antigos
 * (`/?view=…`). Funções puras; a barra e o redirecionamento só leem daqui.
 */
export type AppRoute = {
  path: string;
  title: string;
  /** Rótulo e ícone na barra de baixo; ausente = rota fora da barra. */
  nav?: { label: string; icon: string };
};

export const APP_ROUTES: AppRoute[] = [
  { path: "/", title: "Agora", nav: { label: "Agora", icon: "month" } },
  {
    path: "/movimentos",
    title: "Extrato",
    nav: { label: "Extrato", icon: "movements" },
  },
  {
    path: "/panorama",
    title: "Hábitos",
    nav: { label: "Hábitos", icon: "future" },
  },
  {
    path: "/copiloto",
    title: "Planos",
    nav: { label: "Planos", icon: "copiloto" },
  },
  { path: "/judite", title: "Judite", nav: { label: "Judite", icon: "help" } },
  { path: "/espaco", title: "Nosso espaço" },
];

export function titleFor(pathname: string): string {
  return APP_ROUTES.find((r) => r.path === pathname)?.title ?? "Agora";
}

/** Links antigos: `?view=` -> rota nova. "future" já era redirecionado ao Panorama. */
const LEGACY_VIEWS: Record<string, string> = {
  month: "/",
  movements: "/movimentos",
  panorama: "/panorama",
  future: "/panorama",
  copiloto: "/copiloto",
  help: "/judite",
  us: "/espaco",
};

/** Destino de um `?view=` antigo, ou null quando o valor não é conhecido. */
export function legacyViewPath(view: string | null | undefined): string | null {
  return view && Object.hasOwn(LEGACY_VIEWS, view) ? LEGACY_VIEWS[view] : null;
}

/** Monta um caminho mantendo o mês na URL (como a URL antiga sempre fez). */
export function withMonth(
  path: string,
  month: string,
  extra: Record<string, string> = {},
): string {
  const query = new URLSearchParams({ month, ...extra });
  return path + "?" + query.toString();
}
