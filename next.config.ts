import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the build on type errors rather than shipping them.
  // NOTE: there is no `eslint` key in Next 16 — `next lint` was removed, so linting is a
  // separate CI step (`npm run lint`), not part of `next build`.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;

// Gives `next dev` access to the real D1/R2/KV bindings from wrangler.jsonc.
// Must come after the default export (OpenNext docs).
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
