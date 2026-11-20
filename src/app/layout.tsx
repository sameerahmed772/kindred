import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kindred — AI Companion & Virtual Relationship Platform",
  description:
    "Build authentic, evolving connections with AI companions featuring semantic long-term memory, adaptive communication, proactive check-ins, and unified voice.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className="antialiased selection:bg-indigo-500/30">{children}</body>
    </html>
  );
}
