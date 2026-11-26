// SEM "use client": componente sem estado (exceção à convenção da seção 2 da spec).
import { Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";

const instrument = Instrument_Sans({ subsets: ["latin"], display: "swap", variable: "--family-font-future" });

/** Invólucro da nova tela: troca a fonte de texto para Instrument Sans só aqui dentro.
 *  Números continuam em Space Grotesk. Use uma vez por página, nunca aninhado. */
export function FutureScope({ children }: { children: ReactNode }) {
  return <div className={`${instrument.variable} fut-scope`}>{children}</div>;
}
