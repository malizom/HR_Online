import type { Metadata } from "next";
// Fonts are self-hosted so the Content-Security-Policy can stay "self" only (doc 08 §4).
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "./globals.css";
import "./calendar.css";
import "./portal.css";

export const metadata: Metadata = {
  title: "People & Leave",
  description: "People portal — onboarding, leave, cover and team calendar.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
