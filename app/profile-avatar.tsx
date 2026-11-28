"use client";
import { cx } from "./ds/shared.ts";

/** Foto de perfil ou, sem foto, a inicial do nome. */
export function ProfileAvatar({
  url,
  name,
  className,
  shape = "rounded-full",
}: {
  url: string | null;
  name: string;
  className: string;
  shape?: "rounded-full" | "rounded-2xl";
}) {
  return (
    <div
      className={cx(
        "flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 font-semibold text-ink",
        className,
        shape,
      )}
    >
      {url ? (
        <img
          src={url}
          alt="Sua foto de perfil"
          width="96"
          height="96"
          className="size-full object-cover"
        />
      ) : (
        <span className="text-2xl" aria-hidden="true">
          {name.charAt(0)}
        </span>
      )}
    </div>
  );
}
