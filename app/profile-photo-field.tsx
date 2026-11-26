"use client";
import { useRef } from "react";
import { Button } from "./ds/button";
import { ProfileAvatar } from "./profile-avatar";

/** Foto atual com "Trocar foto" e "Remover". A foto é salva assim que é escolhida. */
export function ProfilePhotoField({
  photoUrl,
  name,
  busy,
  onPick,
  onRemove,
}: {
  photoUrl: string | null;
  name: string;
  busy: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 items-center gap-4 max-[400px]:items-start">
      <ProfileAvatar
        url={photoUrl}
        name={name}
        className="size-24"
        shape="rounded-box"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p className="m-0 text-sm font-semibold">Foto de perfil</p>
          <p className="m-0 text-xs text-base-content/60">
            Use uma imagem sua. Ela é reduzida antes do envio, sem metadados, e
            não tem link público.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="quiet"
            size="sm"
            icon="image"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Trocar foto
          </Button>
          {photoUrl && (
            <Button
              variant="secondary"
              size="sm"
              icon="trash"
              disabled={busy}
              onClick={onRemove}
            >
              Remover
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label="Escolher foto de perfil"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPick(file);
          }}
        />
      </div>
    </div>
  );
}
