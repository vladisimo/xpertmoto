/**
 * Unified streaming interface for Claude Haiku, implemented against either
 * the Anthropic Messages API directly or OpenRouter's OpenAI-compatible
 * endpoint. The route handler talks only to this module — swapping
 * provider is a config change, not a code change.
 *
 * Both providers normalise to a shared `SupportAIChunk` shape: text
 * deltas, tool-use events, and a final usage/cost payload.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { SupportConfig, SupportAIProviderKind } from "@/lib/support-config";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type SupportAIToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type SupportAIUsage = {
  provider: SupportAIProviderKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  /** USD cost as reported upstream (OpenRouter populates this). */
  upstreamCostUsd?: number;
};

export type SupportAIChunk =
  | { kind: "text"; delta: string }
  | { kind: "tool_use"; toolCall: SupportAIToolCall }
  | { kind: "usage"; usage: SupportAIUsage }
  | { kind: "done" };

export type SupportAIMessage = {
  role: "user" | "assistant";
  content: string;
};

export type SupportAITool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type StreamChatParams = {
  system: string;
  messages: SupportAIMessage[];
  tools: SupportAITool[];
  signal?: AbortSignal;
};

export interface SupportAIProvider {
  readonly kind: SupportAIProviderKind;
  readonly model: string;
  streamChat(params: StreamChatParams): AsyncIterable<SupportAIChunk>;
}

// ---------------------------------------------------------------------------
// Anthropic (direct)
// ---------------------------------------------------------------------------

class AnthropicProvider implements SupportAIProvider {
  readonly kind = "anthropic" as const;
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async *streamChat(params: StreamChatParams): AsyncIterable<SupportAIChunk> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: 1024,
        // A single cached system block containing the FAQ + rules.
        system: [
          {
            type: "text",
            text: params.system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: params.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Messages.Tool["input_schema"],
        })),
      },
      { signal: params.signal },
    );

    // Surface text deltas and tool-use events as they stream in.
    // Track in-progress tool_use inputs because Anthropic sends them as
    // incremental JSON deltas.
    const toolInputBuffers = new Map<number, { id: string; name: string; json: string }>();

    for await (const ev of stream) {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") {
        toolInputBuffers.set(ev.index, {
          id: ev.content_block.id,
          name: ev.content_block.name,
          json: "",
        });
      } else if (ev.type === "content_block_delta") {
        if (ev.delta.type === "text_delta") {
          yield { kind: "text", delta: ev.delta.text };
        } else if (ev.delta.type === "input_json_delta") {
          const buf = toolInputBuffers.get(ev.index);
          if (buf) buf.json += ev.delta.partial_json;
        }
      } else if (ev.type === "content_block_stop") {
        const buf = toolInputBuffers.get(ev.index);
        if (buf) {
          const input = buf.json ? (safeJson(buf.json) ?? {}) : {};
          yield {
            kind: "tool_use",
            toolCall: { id: buf.id, name: buf.name, input },
          };
          toolInputBuffers.delete(ev.index);
        }
      }
    }

    const final = await stream.finalMessage();
    yield {
      kind: "usage",
      usage: {
        provider: "anthropic",
        model: this.model,
        inputTokens: final.usage.input_tokens ?? 0,
        outputTokens: final.usage.output_tokens ?? 0,
        cachedInputTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
    };
    yield { kind: "done" };
  }
}

// ---------------------------------------------------------------------------
// OpenRouter (OpenAI-compatible)
// ---------------------------------------------------------------------------

class OpenRouterProvider implements SupportAIProvider {
  readonly kind = "openrouter" as const;
  readonly model: string;
  private client: OpenAI;

  constructor(
    apiKey: string,
    model: string,
    opts: { baseUrl: string; httpReferer: string; appTitle: string },
  ) {
    this.client = new OpenAI({
      apiKey,
      baseURL: opts.baseUrl,
      defaultHeaders: {
        "HTTP-Referer": opts.httpReferer,
        "X-Title": opts.appTitle,
      },
    });
    this.model = model;
  }

  async *streamChat(params: StreamChatParams): AsyncIterable<SupportAIChunk> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: params.system },
          ...params.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
        tools: params.tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
        // OpenRouter accepts an `extra_body` hint for upstream cache where
        // supported — Anthropic backends honour this for Claude models.
        // Cast because this field is outside the OpenAI typed schema.
        ...({
          usage: { include: true },
        } as Record<string, unknown>),
      },
      { signal: params.signal },
    );

    // Accumulate tool-call input deltas keyed by the OpenAI `index`.
    const toolBuffers = new Map<number, { id: string; name: string; json: string }>();

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) {
        // Final usage-only chunk
        if (chunk.usage) {
          yield {
            kind: "usage",
            usage: {
              provider: "openrouter",
              model: this.model,
              inputTokens: chunk.usage.prompt_tokens ?? 0,
              outputTokens: chunk.usage.completion_tokens ?? 0,
              cachedInputTokens: 0,
              cacheCreationTokens: 0,
              upstreamCostUsd:
                typeof (chunk as unknown as { cost?: number }).cost === "number"
                  ? (chunk as unknown as { cost: number }).cost
                  : undefined,
            },
          };
        }
        continue;
      }
      const delta = choice.delta;
      if (delta?.content) {
        yield { kind: "text", delta: delta.content };
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          let buf = toolBuffers.get(idx);
          if (!buf) {
            buf = {
              id: tc.id ?? `tool_${idx}`,
              name: tc.function?.name ?? "",
              json: "",
            };
            toolBuffers.set(idx, buf);
          }
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.json += tc.function.arguments;
        }
      }
      if (choice.finish_reason === "tool_calls" || choice.finish_reason === "stop") {
        for (const buf of toolBuffers.values()) {
          const input = buf.json ? (safeJson(buf.json) ?? {}) : {};
          yield {
            kind: "tool_use",
            toolCall: { id: buf.id, name: buf.name, input },
          };
        }
        toolBuffers.clear();
      }
    }
    yield { kind: "done" };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export class SupportAIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportAIUnavailableError";
  }
}

export function getSupportAIProvider(cfg: SupportConfig): SupportAIProvider {
  if (!cfg.aiEnabled || !cfg.provider || !cfg.providerApiKey) {
    throw new SupportAIUnavailableError("Support AI is disabled or missing credentials.");
  }
  if (cfg.provider === "anthropic") {
    return new AnthropicProvider(cfg.providerApiKey, cfg.model);
  }
  return new OpenRouterProvider(cfg.providerApiKey, cfg.model, cfg.openRouter);
}

/** Internal — exposed for the unit test harness that injects fixtures. */
export const _internal = { AnthropicProvider, OpenRouterProvider };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Guardrails (run before sending to the model)
// ---------------------------------------------------------------------------

/**
 * Strip any 13-19 digit run that could be a PAN. Replacement leaves a
 * marker so staff can see the customer tried to share card details.
 */
export function scrubCardDigits(body: string): string {
  return body.replace(/(?:\d[ -]?){12,18}\d/g, "[card-number-removed]");
}

/**
 * Returns true if the user turn mentions refund/chargeback/dispute — the
 * route handler force-creates a PAYMENT ticket rather than letting the
 * AI free-chat about money.
 */
export function mentionsMoneyDispute(body: string): boolean {
  return /refund|chargeback|dispute|double[\- ]?charge|unauthorised/i.test(body);
}

/**
 * Returns true for roadside / breakdown language so the route handler
 * can elevate priority to URGENT.
 */
export function mentionsRoadsideBreakdown(body: string): boolean {
  return /stranded|on the road|won['']?t start|crash|broken down|accident/i.test(body);
}

/**
 * Tool definitions surfaced to the model. Names/semantics are stable —
 * the chat route handler dispatches on these exact names.
 */
export const SUPPORT_AI_TOOLS: SupportAITool[] = [
  {
    name: "escalate_to_human",
    description:
      "Hand off to a human agent. Use when the AI cannot resolve the question or the customer asks for a person.",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief reason for the escalation." },
        category: {
          type: "string",
          enum: ["GENERAL", "PAYMENT", "BREAKDOWN", "ABANDONED_VEHICLE"],
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "create_ticket",
    description:
      "Open a ticket for the support team. Use for BREAKDOWN, ABANDONED_VEHICLE, or PAYMENT issues that need a human responder.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["BREAKDOWN", "ABANDONED_VEHICLE", "PAYMENT", "GENERAL"],
        },
        summary: {
          type: "string",
          description: "One-line summary (under 80 chars) shown in the staff inbox.",
        },
        urgency: {
          type: "boolean",
          description:
            "True for roadside breakdowns, safety issues, or anything needing a same-hour response.",
        },
      },
      required: ["category", "summary", "urgency"],
    },
  },
];
