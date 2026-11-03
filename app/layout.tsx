import type { Metadata } from "next";
import "./globals.css";
import "./calendar.css";

export const metadata: Metadata = {
  title: "MVR Attorneys | People & Leave",
  description: "MVR Attorneys people portal — onboarding, leave and team calendar.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
