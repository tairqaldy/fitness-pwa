import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import d1NextTagCache from "@opennextjs/cloudflare/overrides/tag-cache/d1-next-tag-cache";

// NOTE: no `queue` override. The do-queue override requires a NEXT_CACHE_DO_QUEUE Durable
// Object binding in wrangler.jsonc; configuring one without the other fails silently.
// Add both together when we first use on-demand revalidation. See docs/research/r12 §H.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  tagCache: d1NextTagCache,
});
