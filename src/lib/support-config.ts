/**
 * Support chatbot feature flags + provider resolution.
 *
 * Read env once per request via `getSupportConfig()` and pass booleans
 * around. A single truth source keeps the widget gate, tRPC middleware,
 * and chat API route coherent — they can never diverge.
 */

export type SupportAIProviderKind = "anthropic" | "openrouter";

export interface SupportConfig {
  enabled: boolean;
  aiEnabled: boolean;
  feedbackEnabled: boolean;
  provider: SupportAIProviderKind | null;
  providerApiKey: string | null;
  model: string;
  openRouter: {
    baseUrl: string;
    httpReferer: string;
    appTitle: string;
  };
  costCapAudDaily: number;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

function resolveProvider(
  forced: string | undefined,
  anthropicKey: string | undefined,
  openRouterKey: string | undefined,
): { provider: SupportAIProviderKind | null; key: string | null } {
  const anthropic = anthropicKey && anthropicKey.length > 0 ? anthropicKey : null;
  const openRouter = openRouterKey && openRouterKey.length > 0 ? openRouterKey : null;

  if (forced === "anthropic" && anthropic) return { provider: "anthropic", key: anthropic };
  if (forced === "openrouter" && openRouter) return { provider: "openrouter", key: openRouter };
  if (openRouter) return { provider: "openrouter", key: openRouter };
  if (anthropic) return { provider: "anthropic", key: anthropic };
  return { provider: null, key: null };
}

function defaultModel(provider: SupportAIProviderKind | null, override: string | undefined): string {
  if (override && override.length > 0) return override;
  if (provider === "openrouter") return "anthropic/claude-haiku-4.5";
  return "claude-haiku-4-5-20251001";
}

export function getSupportConfig(): SupportConfig {
  const { provider, key } = resolveProvider(
    process.env.SUPPORT_AI_PROVIDER,
    process.env.ANTHROPIC_API_KEY,
    process.env.OPENROUTER_API_KEY,
  );
  const aiEnabledExplicit = bool(process.env.SUPPORT_AI_ENABLED, true);
  const aiEnabled = aiEnabledExplicit && provider !== null;

  return {
    enabled: bool(process.env.SUPPORT_ENABLED, true),
    aiEnabled,
    feedbackEnabled: bool(process.env.SUPPORT_FEEDBACK_ENABLED, true),
    provider,
    providerApiKey: key,
    model: defaultModel(provider, process.env.SUPPORT_AI_MODEL),
    openRouter: {
      baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? "https://scootering.com.au",
      appTitle: process.env.OPENROUTER_APP_TITLE ?? "Scootering Support",
    },
    costCapAudDaily: Number.parseFloat(process.env.SUPPORT_COST_CAP_AUD_DAILY ?? "25"),
  };
}

/** Client-safe subset — for passing from a server component to the widget. */
export interface SupportPublicConfig {
  enabled: boolean;
  aiEnabled: boolean;
  feedbackEnabled: boolean;
}

export function toPublicConfig(cfg: SupportConfig): SupportPublicConfig {
  return {
    enabled: cfg.enabled,
    aiEnabled: cfg.aiEnabled,
    feedbackEnabled: cfg.feedbackEnabled,
  };
}
