/**
 * Secret access.
 *
 * Secrets set with `wrangler secret put` are surfaced on `process.env` by OpenNext's Node
 * runtime. They are deliberately NOT declared in wrangler.jsonc `vars`, so `wrangler types`
 * does not know about them — hence this module rather than a typed binding.
 *
 * Every accessor either returns a validated value or throws. Nothing here falls back to a
 * default, because a silently-absent secret is how an app ends up unauthenticated in
 * production or calling an AI provider with no key and reporting "no results".
 */

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(
      `Secret ${name} is not set. Add it to .dev.vars for local dev, or run: npx wrangler secret put ${name}`,
    );
    this.name = "MissingSecretError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new MissingSecretError(name);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** Session cookie signing key. Required for the app to function at all. */
export function sessionSecret(): string {
  return required("SESSION_SECRET");
}

/**
 * Optional integrations. Each returns undefined when unconfigured so the feature can degrade
 * gracefully with an honest message instead of throwing at the user.
 */
export const optionalSecrets = {
  googleAiKey: () => optional("GOOGLE_GENERATIVE_AI_API_KEY"),
  anthropicKey: () => optional("ANTHROPIC_API_KEY"),
  openaiKey: () => optional("OPENAI_API_KEY"),
  telegramBotToken: () => optional("TELEGRAM_BOT_TOKEN"),
  telegramChatId: () => optional("TELEGRAM_CHAT_ID"),
  telegramWebhookSecret: () => optional("TELEGRAM_WEBHOOK_SECRET"),
  vapidPrivateKey: () => optional("VAPID_PRIVATE_KEY"),
  usdaFdcKey: () => optional("USDA_FDC_KEY"),
  cronSecret: () => optional("CRON_SECRET"),
} as const;

/** True when the AI features have a usable key for the configured provider. */
export function aiConfigured(provider: string = process.env["AI_PROVIDER"] ?? "google"): boolean {
  switch (provider) {
    case "google":
      return Boolean(optionalSecrets.googleAiKey());
    case "anthropic":
      return Boolean(optionalSecrets.anthropicKey());
    case "openai":
      return Boolean(optionalSecrets.openaiKey());
    default:
      return false;
  }
}

export function telegramConfigured(): boolean {
  return Boolean(optionalSecrets.telegramBotToken() && optionalSecrets.telegramChatId());
}
