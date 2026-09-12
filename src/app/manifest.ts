import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest by the App Router.
 *
 * `display: "standalone"` plus the black theme colour is what makes the app open without
 * browser chrome on an OLED phone. `start_url` deliberately has no locale prefix — the app is
 * single-locale-per-user and a prefixed start URL would fight the service worker's precache.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Форма — дневник тренировок",
    short_name: "Форма",
    description: "Личный дневник тренировок, питания и прогресса.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "ru",
    dir: "ltr",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
