"use client";
import { Select } from "./ds/select";
import { useEffect, useState } from "react";
import { Field } from "./field";

export function FamilyIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    month: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18m-12 5 2 2 4-4" />
      </>
    ),
    movements: <path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" />,
    future: <path d="m3 17 6-6 4 3 8-10m-6 0h6v6M3 21h18" />,
    copiloto: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3.5v2m0 13v2M3.5 12h2m13 0h2" />
      </>
    ),
    help: (
      <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" />
    ),
    eye: (
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    us: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1" />
      </>
    ),
  };
  return (
    <svg
      className="family-svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.help}
    </svg>
  );
}
export function ThemeControl() {
  const [theme, setTheme] = useState("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("entre-nos-theme-v1");
      if (saved && ["system", "light", "dark"].includes(saved)) setTheme(saved);
    } catch {}
  }, []);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <Field className="family-theme" label="Aparência">
      <Select
        aria-label="Aparência"
        value={theme}
        onChange={(e) => {
          const next = e.target.value;
          setTheme(next);
          try {
            localStorage.setItem("entre-nos-theme-v1", next);
          } catch {}
        }}
      >
        <option value="system">Do aparelho</option>
        <option value="light">Claro</option>
        <option value="dark">Escuro</option>
      </Select>
    </Field>
  );
}
export { HelpPanel } from "./family-chat";
