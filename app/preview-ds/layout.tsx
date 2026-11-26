import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Vitrine · design system",
  robots: { index: false, follow: false },
};

export default function PreviewDsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
