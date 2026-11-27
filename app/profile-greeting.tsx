"use client";
import { ProfileAvatar } from "./profile-avatar";

/** Faixa de boas-vindas do perfil. */
export function ProfileGreeting({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl: string | null;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface-2 p-4">
      <ProfileAvatar url={photoUrl} name={name} className="size-16" />
      <div className="min-w-0">
        <h3 className="m-0 text-lg leading-snug font-semibold text-ink">
          Olá, {name.split(" ")[0]}!
        </h3>
        <p className="m-0 text-sm text-muted">
          Estas escolhas são só suas e acompanham sua conta em outros aparelhos.
          Os dados financeiros continuam compartilhados com a família.
        </p>
      </div>
    </div>
  );
}
