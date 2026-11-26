import type { Metadata } from "next";
import { Instrument_Sans, Manrope } from "next/font/google";
import "./copiloto.css";

/** Fontes só dos protótipos: Instrument Sans (voz editorial de A e D) e
 *  Manrope (jornada, B). Texto e números seguem DM Sans / Space Grotesk do DS. */
const display = Instrument_Sans({ subsets: ["latin"], display: "swap", variable: "--cf-font-display" });
const journey = Manrope({ subsets: ["latin"], display: "swap", variable: "--cf-font-journey" });

export const metadata: Metadata = {
  title: "Copiloto · protótipos",
  robots: { index: false, follow: false },
};

export default function CopilotPrototypeLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${display.variable} ${journey.variable}`}>{children}</div>;
}
