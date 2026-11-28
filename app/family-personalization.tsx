"use client";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { type HomeCardId, type Preferences } from "../src/domain/preferences";
import { Button } from "./ds/button";
import { preparePhoto, saveProfile } from "./profile-photo";
import { ProfileAppearance } from "./profile-appearance";
import { ProfileGreeting } from "./profile-greeting";
import { ProfilePhotoField } from "./profile-photo-field";

export function HomeBlock({
  children,
}: {
  cardId: HomeCardId;
  caption?: string;
  collapsible?: boolean;
  children: ReactNode;
}) {
  return <>{children}</>;
}
export { HomeLayout } from "./home-editor";

export function PreferencesPanel({
  preferences,
  onSaved,
  name,
  onTour,
}: {
  preferences: Preferences;
  onSaved: (p: Preferences) => void;
  name: string;
  onTour: () => void;
  onEditHome?: () => void;
}) {
  const [draft, setDraft] = useState(preferences),
    [photo, setPhoto] = useState<string | null | undefined>(),
    [busy, setBusy] = useState(false),
    [processing, setProcessing] = useState(false),
    [message, setMessage] = useState("");
  const photoSequence = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    setDraft((prior) => ({
      ...prior,
      accent: preferences.accent,
      theme: preferences.theme,
    }));
  }, [preferences.accent, preferences.theme]);
  useEffect(
    () => () => {
      photoSequence.current++;
    },
    [],
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving.current || processing) return;
    saving.current = true;
    setBusy(true);
    setMessage("");
    try {
      const p = await saveProfile("preferences", {
        revision: preferences.revision,
        accent: draft.accent,
        theme: draft.theme,
        ...(photo !== undefined ? { photo } : {}),
      });
      onSaved(p);
      setPhoto(undefined);
      setMessage("Seu espaço foi salvo na sua conta.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }
  async function savePhoto(value: string | null) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setPhoto(value);
    setMessage("");
    try {
      const p = await saveProfile("preferences", {
        revision: preferences.revision,
        photo: value,
      });
      onSaved(p);
      setPhoto(undefined);
      setMessage(
        value === null
          ? "Sua foto foi removida da conta."
          : "Foto salva na sua conta e atualizada no cabeçalho.",
      );
    } catch (error) {
      setMessage(
        (error instanceof Error
          ? error.message
          : "Não foi possível salvar a foto.") +
          " A alteração ainda não foi salva. Tente novamente em Salvar meu espaço.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function pickPhoto(file: File) {
    const seq = ++photoSequence.current;
    setProcessing(true);
    setMessage("");
    try {
      const result = await preparePhoto(file);
      if (seq === photoSequence.current) await savePhoto(result);
    } catch (error) {
      if (seq === photoSequence.current)
        setMessage(error instanceof Error ? error.message : "Foto inválida.");
    } finally {
      if (seq === photoSequence.current) setProcessing(false);
    }
  }
  const photoUrl = photo
    ? "data:image/jpeg;base64," + photo
    : photo === null
      ? null
      : preferences.has_photo
        ? "/api/profile/photo?v=" + preferences.revision
        : null;
  return (
    <div
      role="region"
      aria-label="Minha personalização"
      className="personalization flex flex-col gap-3"
    >
      <ProfileGreeting name={name} photoUrl={photoUrl} />
      <form onSubmit={save} className="flex flex-col gap-3">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <fieldset
            disabled={busy}
            className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
          >
            <legend className="mb-1 w-full p-0 text-base font-semibold text-ink">
              Meu perfil e aparência
            </legend>
            <ProfilePhotoField
              photoUrl={photoUrl}
              name={name}
              busy={busy || processing}
              onPick={(file) => void pickPhoto(file)}
              onRemove={() => {
                photoSequence.current++;
                setProcessing(false);
                void savePhoto(null);
              }}
            />
            <ProfileAppearance
              theme={draft.theme}
              onTheme={(theme) => setDraft({ ...draft, theme })}
              accent={draft.accent}
              onAccent={(accent) => setDraft({ ...draft, accent })}
            />
          </fieldset>
        </section>
        <Button
          type="submit"
          variant="primary"
          icon="check"
          className="w-full"
          busy={busy || processing}
        >
          {processing
            ? "Preparando foto…"
            : busy
              ? "Salvando…"
              : "Salvar meu espaço"}
        </Button>
        {message && (
          <p
            role="status"
            className="m-0 rounded-xl border border-info/25 bg-info-bg px-4 py-3 text-sm font-medium text-ink"
          >
            {message}
          </p>
        )}
      </form>
      <Button variant="quiet" size="sm" className="self-start" onClick={onTour}>
        Ver apresentação do app
      </Button>
    </div>
  );
}
export { GuidedTour as AppOverview } from "./guided-tour";
