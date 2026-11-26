"use client";

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
  shape?: "rounded-full" | "rounded-box";
}) {
  return (
    <div
      className={url ? "avatar shrink-0" : "avatar avatar-placeholder shrink-0"}
    >
      <div className={`${className} ${shape} bg-base-300 text-base-content`}>
        {url ? (
          <img src={url} alt="Sua foto de perfil" width="96" height="96" />
        ) : (
          <span className="text-2xl" aria-hidden="true">
            {name.charAt(0)}
          </span>
        )}
      </div>
    </div>
  );
}
