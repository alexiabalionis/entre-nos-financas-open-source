"use client";
import { cx } from "./shared";

export type IconName =
  | "plus"
  | "minus"
  | "check"
  | "close"
  | "left"
  | "right"
  | "up"
  | "down"
  | "eye"
  | "undo"
  | "flag"
  | "info"
  | "pause"
  | "play"
  | "alert"
  | "spark"
  | "sparkle"
  | "layers"
  | "calendar"
  | "card"
  | "in"
  | "out"
  | "search"
  | "edit"
  | "refresh"
  | "bank"
  | "shield"
  | "link"
  | "more"
  | "image"
  | "trash";

/** O texto é um nome de ícone do DS (e não um glifo como "↻")? */
export const isIconName = (value: string): value is IconName =>
  Object.hasOwn(PATHS, value);

const PATHS: Record<IconName, string> = {
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  eye: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  undo: "M9 7H5V3M5.3 7A8 8 0 1 1 4 12",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  info: "M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  pause: "M9 5v14M15 5v14",
  play: "M7 5l12 7-12 7V5Z",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  alert:
    "M12 9v4m0 4v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4",
  // Marca da Judite (mesma estrela da navegação).
  sparkle: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z",
  layers: "M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  calendar:
    "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  card: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Zm0 3h18M7 15h3",
  in: "M17 7 7 17m0-8v8h8",
  out: "M7 17 17 7m-8 0h8v8",
  edit: "M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4",
  refresh: "M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4",
  bank: "M3 10 12 4l9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18",
  shield:
    "M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Zm-3 9 2.5 2.5L15.5 10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  more: "M12 5v.01M12 12v.01M12 19v.01",
  image:
    "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 12 5-5 4 4 3-3 5 5M9 9.5v.01",
  trash:
    "M4 7h16M10 11v6m4-6v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3",
};

/**
 * Ícone SVG de traço (24×24, 1.75). Sem `title` fica escondido de leitor de
 * tela; com `title` vira imagem nomeada. Não é botão: para ação use IconButton.
 */
export function Icon({
  name,
  size = 18,
  title,
  className,
}: {
  name: IconName;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={cx("ds-icon", className)}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}
