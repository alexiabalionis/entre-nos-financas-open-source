import type { Preferences } from "../src/domain/preferences";

export async function saveProfile(
  path: string,
  body: unknown,
): Promise<Preferences> {
  const r = await fetch("/api/profile/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Não foi possível salvar.");
  return data;
}

/** Recorta no centro, reduz para 256px e devolve o JPEG em base64 (sem metadados). */
export async function preparePhoto(file: File) {
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024)
    throw new Error("Escolha uma foto de até 12 MB.");
  try {
    // data: images are permitted by the app CSP; blob: URLs deliberately are not.
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Não foi possível ler a foto."));
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Foto inválida."));
      reader.readAsDataURL(file);
    });
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error();
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(
      img,
      (img.naturalWidth - size) / 2,
      (img.naturalHeight - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  } catch {
    throw new Error(
      "Não foi possível abrir essa foto. Tente JPG, PNG ou WebP.",
    );
  }
}
