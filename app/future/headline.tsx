"use client";
import { ChangedText } from "../ds/index.ts";
import { useFutureContext } from "./future-context.tsx";
import { HorizonSwitch } from "./horizon-switch.tsx";
import { headline } from "./view-model.ts";

export function Headline() {
  const f = useFutureContext();
  const result = f.draft ?? f.base;
  const input = f.draftInput;
  const text =
    result && input
      ? headline(input, result, f.months, f.hidden)
      : { lead: f.status === "error" ? f.error : "Carregando o futuro…", detail: "" };
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
      <div className="grid min-w-0 flex-1 basis-80 max-w-3xl gap-1.5">
        <p className="m-0 text-xs font-semibold uppercase tracking-wider text-muted">
          O futuro de vocês
        </p>
        <h2
          className="m-0 text-2xl font-semibold tracking-tight text-ink sm:text-3xl leading-[1.15]"
          aria-live="polite"
        >
          <ChangedText value={text.lead} />
        </h2>
        {text.detail ? (
          <p className="m-0 text-sm leading-relaxed text-muted">{text.detail}</p>
        ) : null}
      </div>
      <div className="max-w-full overflow-x-auto">
        <HorizonSwitch />
      </div>
    </header>
  );
}
