"use client";
import { useState } from "react";
import { AvatarCluster } from "./ds/avatar-cluster";
import { personColor } from "./month/blocks/month-header";
export function HeaderAvatar({
  hasPhoto,
  revision,
  name,
}: {
  hasPhoto: boolean;
  revision: number;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  return hasPhoto && !failed ? (
    <img
      className="personal-avatar"
      src={"/api/profile/photo?v=" + revision}
      alt="Minha foto de perfil"
      width="36"
      height="36"
      decoding="async"
      onError={() => setFailed(true)}
    />
  ) : (
    <AvatarCluster people={[{ initial: name.charAt(0), color: personColor(0) }]} />
  );
}
