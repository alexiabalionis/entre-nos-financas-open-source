"use client";
import type { CSSProperties } from "react";

type Person = {
  /** Inicial(is) mostrada no círculo. */
  initial: string;
  /** Cor da pessoa (dado dinâmico, não token). Opcional. */
  color?: string;
};

type AvatarClusterProps = {
  people: Person[];
};

/**
 * Pilha de avatares sobrepostos com iniciais. Sem cor explícita, cada avatar
 * usa o tint/accent do tema (family.css). Quando a pessoa tem cor própria,
 * aplicamos inline — exceção justificada: cor por pessoa é DADO, não um token
 * de design.
 */
export function AvatarCluster({ people }: AvatarClusterProps) {
  return (
    <div className="ds-avatars">
      {people.map((p, i) => {
        // Cor por pessoa é dado dinâmico: passamos como custom property e o CSS
        // deriva o tint via color-mix (.ds-avatar[style*=--ds-avatar-color]).
        // Nada de aritmética de hex em JS — ela quebra com #rgb/rgb()/nome.
        const style: CSSProperties | undefined = p.color
          ? ({ "--ds-avatar-color": p.color } as CSSProperties)
          : undefined;
        return (
          <span key={i} className="ds-avatar" style={style}>
            {p.initial}
          </span>
        );
      })}
    </div>
  );
}
