import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the build on type errors rather than shipping them.
  // NOTE: there is no `eslint` key in Next 16 — `next lint` was removed, so linting is a
  // separate CI step (`npm run lint`), not part of `next build`.
  typescript: { ignoreBuildErrors: false },
};

// next-intl runs in "without i18n routing" mode: no [locale] segment, no next-intl
// middleware. The whole integration is this plugin plus src/i18n/request.ts, so it adds zero
// OpenNext-specific surface (proxy.ts support there is experimental).
export default createNextIntlPlugin()(nextConfig);

// Gives `next dev` access to the real D1/R2/KV bindings from wrangler.jsonc.
// Must come after the default export (OpenNext docs).
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
