import { brDate } from "../../src/domain/format.ts";
import { plural, type Decisions, type PreviewGroups, type PreviewMode } from "./preview-model.ts";

/** `end`: último dia em que a conta vale (só no modo "end"). */
type Subject = { label: string; month: string; from: string; end?: string };

export function previewCopy(mode: PreviewMode, s: Subject) {
  if (mode === "end") {
    const end = s.end ?? s.from;
    return {
      title: `Encerrar ${s.label}`,
      intro: `${s.label} vale até ${brDate(end)}. Depois disso deixa de ser criado. O que já passou não muda.`,
      confirm: `Encerrar em ${brDate(end)}`,
    };
  }
  return {
    title: "Esta e as próximas",
    intro: `Vale para ${s.label} a partir de ${brDate(s.from)}, incluindo esta. O que já passou não muda.`,
    confirm: "Atualizar esta e as próximas",
  };
}

function counts(groups: PreviewGroups, decisions: Decisions) {
  const chosen = groups.edited.filter((e) => decisions[e.monthly_item_id]);
  const kept = chosen.filter((e) => decisions[e.monthly_item_id] === "keep").length;
  return { kept, changed: groups.replaced.length + chosen.length - kept };
}

/** Aviso de sucesso depois de confirmar, com o que mudou e o que ficou como estava. */
export function previewDone(
  mode: PreviewMode,
  s: Subject,
  groups: PreviewGroups,
  decisions: Decisions,
): string {
  const { kept, changed } = counts(groups, decisions);
  const untouched = groups.preserved.length + groups.cancelled.length > 0;
  if (mode === "end")
    return `${s.label} encerrado em ${brDate(s.end ?? s.from)}.${groups.preserved.length ? " As contas já pagas ficaram no histórico." : ""}`;
  const parts = [
    `Pronto. ${changed} ${plural(changed, "conta atualizada", "contas atualizadas")}.`,
    kept ? `${kept} ${plural(kept, "ajuste seu mantido", "ajustes seus mantidos")}.` : "",
    untouched ? "As contas pagas e as puladas ficaram como estavam." : "",
  ];
  return parts.filter(Boolean).join(" ");
}
