import { defineConfig } from "drizzle-kit";

// D1 uses the `sqlite` dialect. We only ever use drizzle-kit to GENERATE SQL;
// it is applied by `wrangler d1 migrations apply`, which is why `out` points at the
// folder wrangler.jsonc declares as `migrations_dir`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle/migrations",
  casing: "snake_case",
  verbose: true,
  strict: true,
});
