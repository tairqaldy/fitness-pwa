import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, never hand-edited. `cloudflare-env.d.ts` is ~15k lines of inlined workerd
    // runtime types from `wrangler types`; linting it only produces noise about its own
    // eslint-disable directives.
    "cloudflare-env.d.ts",
    ".open-next/**",
    ".wrangler/**",
    "drizzle/migrations/**",
  ]),
]);

export default eslintConfig;
