"use client";
import { useRouter } from "next/navigation";
import { Button } from "../button";

/** Leva de um item fixo do jeito antigo para a conversão em conta fixa, em Nosso espaço. */
export function LegacyFixedLink() {
  const router = useRouter();
  return (
    <div>
      <p className="ds-caption">
        Este item foi marcado como fixo à mão e não se repete sozinho.
      </p>
      <Button
        type="button"
        variant="text"
        onClick={() => router.push("/espaco?painel=fixed")}
      >
        Transformar em conta fixa
      </Button>
    </div>
  );
}
