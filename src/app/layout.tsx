import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

/**
 * Font choice is constrained by the default locale being Russian: the `cyrillic` subset is
 * mandatory. Geist (create-next-app's default) has no Cyrillic coverage, so Inter is used for
 * body text and JetBrains Mono for the tabular numeric readouts, both of which do.
 */
const appSans = Inter({
  variable: "--font-app-sans",
  subsets: ["latin", "latin-ext", "cyrillic"],
  display: "swap",
});

const appMono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Форма", template: "%s · Форма" },
  description: "Личный дневник тренировок, питания и прогресса.",
  applicationName: "Форма",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Форма" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Pure black so the browser chrome merges into the OLED canvas.
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // The app is a tool used one-handed mid-set; an accidental pinch-zoom is pure friction.
  // Zoom is left ENABLED (never maximum-scale=1) because disabling it is an a11y failure.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      // `dark` is permanent: this is a dark-first single-user app.
      className={`dark h-full ${appSans.variable} ${appMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
