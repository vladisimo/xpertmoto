/**
 * Claude vision wrapper for licence / passport OCR. Used by the customer
 * booking wizard Step 4 and the staff-side customer profile upload form
 * to pre-fill fields from an uploaded photo.
 *
 * The model is asked to emit a structured JSON object via tool-use so we
 * get guaranteed-shape output instead of parsing free-text. On any
 * failure — low confidence, missing key, network error — we return an
 * empty object and let the form behave as if no pre-fill happened.
 *
 * The wrapper never throws for caller-visible failures; callers treat the
 * output purely as suggestions.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { z } from "zod";
import { recordOcrUsage, type OcrLogContext, type OcrUsage } from "./ocr-cost";
import { trackAiGeneration } from "@/lib/analytics";
import { USD_AUD_RATE } from "@/lib/constants";

const MIN_CONFIDENCE = 0.7;

/** Anthropic-direct default; picked when only ANTHROPIC_API_KEY is set. */
const DEFAULT_MODEL_ANTHROPIC = "claude-sonnet-4-6";
/** OpenRouter default; picked when OPENROUTER_API_KEY is set. */
const DEFAULT_MODEL_OPENROUTER = "anthropic/claude-sonnet-4.6";

/**
 * What kind of identity document the model actually sees in the image —
 * classified by *function*, not physical format (a passport-style driver
 * licence is `DRIVERS_LICENCE`; an international driving permit is
 * `DRIVERS_LICENCE`; anything that is not a licence or a passport bio-data
 * page is `OTHER`). Callers compare this against the document slot they
 * expected and decide whether to accept, nudge, or reject.
 */
export type DocumentClassification = "DRIVERS_LICENCE" | "PASSPORT" | "OTHER";

export interface ExtractLicenceData {
  licenceNumber?: string;
  state?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  expiryDate?: Date;
  licenceClass?: string;
  conditions?: string;
  country?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  addressState?: string;
  postcode?: string;
  /**
   * Face bounding box as normalised coordinates (0-1) relative to the
   * source image dimensions. Absent if Claude couldn't locate a face.
   */
  faceBoundingBox?: { x: number; y: number; width: number; height: number };
  /**
   * The kind of document the model classified the image as. Present whenever
   * the model returned a structured result; absent only on a hard failure
   * (network error / no tool call / schema mismatch) so callers can tell
   * "couldn't reach the model" apart from "wrong document type". When this is
   * not `DRIVERS_LICENCE`, no licence fields are populated.
   */
  documentType?: DocumentClassification;
  confidence: number;
}

/**
 * Persisted shape stored on CustomerDocument.metadata after a staff
 * member runs the detector. Dates are serialised as ISO strings because
 * JSON can't carry Date objects.
 */
export interface DetectedLicenceMetadata {
  kind: "licence";
  detectedAt: string;
  detectedById?: string;
  confidence: number;
  /** What the detector classified the image as, for audit traceability. */
  documentType?: DocumentClassification;
  licenceNumber?: string;
  state?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  expiryDate?: string;
  licenceClass?: string;
  conditions?: string;
  country?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  addressState?: string;
  postcode?: string;
  faceImageKey?: string;
  faceBoundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * Persisted shape stored on CustomerDocument.metadata after the detector
 * runs on a PASSPORT row. Parallel to DetectedLicenceMetadata; `kind` is
 * the discriminator that consumers branch on.
 */
export interface DetectedPassportMetadata {
  kind: "passport";
  detectedAt: string;
  detectedById?: string;
  confidence: number;
  /** What the detector classified the image as, for audit traceability. */
  documentType?: DocumentClassification;
  passportNumber?: string;
  country?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  expiryDate?: string;
}

export interface ExtractPassportData {
  passportNumber?: string;
  country?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  expiryDate?: Date;
  /**
   * The kind of document the model classified the image as. See
   * `ExtractLicenceData.documentType`. When this is not `PASSPORT`, no
   * passport fields are populated.
   */
  documentType?: DocumentClassification;
  confidence: number;
}

/** Infringement category aligned to the Prisma `InfringementType` enum. */
export type InfringementTypeGuess =
  | "SPEEDING"
  | "PARKING"
  | "TOLL"
  | "RED_LIGHT"
  | "MOBILE_PHONE"
  | "SEATBELT"
  | "UNREGISTERED"
  | "OTHER";

/** Whether the image actually is a penalty / infringement notice. */
export type NoticeClassification = "PENALTY_NOTICE" | "OTHER";

/**
 * Fields extracted from a scanned/photographed NSW penalty notice. Every
 * field is a SUGGESTION ONLY — staff confirm before an Infringement row is
 * created. Empty object (confidence 0) on any failure.
 */
export interface ExtractInfringementData {
  penaltyNoticeNumber?: string;
  vehicleRego?: string;
  issuer?: string;
  offenceCode?: string;
  offenceDescription?: string;
  offenceLocation?: string;
  /** When the offence occurred (used to match the renter). */
  offenceDate?: Date;
  /** When the notice was issued (drives the 21-day nomination deadline). */
  issueDate?: Date;
  /** Issuer fine amount in AUD. */
  amount?: number;
  demeritPoints?: number;
  type?: InfringementTypeGuess;
  /** What the model classified the image as. Not PENALTY_NOTICE → no fields. */
  documentType?: NoticeClassification;
  confidence: number;
}

const licenceToolSchema = z.object({
  licenceNumber: z.string().optional(),
  state: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  expiryDate: z.string().optional(),
  licenceClass: z.string().optional(),
  conditions: z.string().optional(),
  country: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  suburb: z.string().optional(),
  addressState: z.string().optional(),
  postcode: z.string().optional(),
  faceBoundingBox: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .optional(),
  documentType: z.enum(["DRIVERS_LICENCE", "PASSPORT", "OTHER"]).optional(),
  confidence: z.number().min(0).max(1),
});

const passportToolSchema = z.object({
  passportNumber: z.string().optional(),
  country: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  expiryDate: z.string().optional(),
  documentType: z.enum(["DRIVERS_LICENCE", "PASSPORT", "OTHER"]).optional(),
  confidence: z.number().min(0).max(1),
});

const infringementToolSchema = z.object({
  penaltyNoticeNumber: z.string().optional(),
  vehicleRego: z.string().optional(),
  issuer: z.string().optional(),
  offenceCode: z.string().optional(),
  offenceDescription: z.string().optional(),
  offenceLocation: z.string().optional(),
  offenceDate: z.string().optional(),
  issueDate: z.string().optional(),
  amount: z.number().optional(),
  demeritPoints: z.number().optional(),
  type: z
    .enum([
      "SPEEDING",
      "PARKING",
      "TOLL",
      "RED_LIGHT",
      "MOBILE_PHONE",
      "SEATBELT",
      "UNREGISTERED",
      "OTHER",
    ])
    .optional(),
  documentType: z.enum(["PENALTY_NOTICE", "OTHER"]).optional(),
  confidence: z.number().min(0).max(1),
});

export class DocumentExtractUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentExtractUnavailableError";
  }
}

type ProviderKind = "anthropic" | "openrouter";

interface ResolvedProvider {
  kind: ProviderKind;
  model: string;
  apiKey: string;
  openRouter?: { baseUrl: string; httpReferer: string; appTitle: string };
}

/**
 * Resolve which provider to use. `DOCUMENT_EXTRACT_PROVIDER` forces a
 * specific one (if the corresponding key is present). Otherwise
 * `SUPPORT_AI_PROVIDER` is honoured for consistency with the support
 * chatbot. Absent both, we prefer OpenRouter when its key is present,
 * since that's the cheaper / pooled path.
 */
function getProvider(): ResolvedProvider | null {
  const forced =
    process.env.DOCUMENT_EXTRACT_PROVIDER ||
    process.env.SUPPORT_AI_PROVIDER ||
    "";
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";
  const openRouterKey = process.env.OPENROUTER_API_KEY ?? "";

  const openRouter = {
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    httpReferer: process.env.OPENROUTER_HTTP_REFERER ?? "https://xpertmoto.com.au",
    appTitle: process.env.OPENROUTER_APP_TITLE ?? "XPERT Moto Document Extract",
  };

  const modelOverride = process.env.DOCUMENT_EXTRACT_MODEL;

  if (forced === "anthropic" && anthropicKey) {
    return {
      kind: "anthropic",
      apiKey: anthropicKey,
      model: modelOverride || DEFAULT_MODEL_ANTHROPIC,
    };
  }
  if (forced === "openrouter" && openRouterKey) {
    return {
      kind: "openrouter",
      apiKey: openRouterKey,
      model: modelOverride || DEFAULT_MODEL_OPENROUTER,
      openRouter,
    };
  }
  if (openRouterKey) {
    return {
      kind: "openrouter",
      apiKey: openRouterKey,
      model: modelOverride || DEFAULT_MODEL_OPENROUTER,
      openRouter,
    };
  }
  if (anthropicKey) {
    return {
      kind: "anthropic",
      apiKey: anthropicKey,
      model: modelOverride || DEFAULT_MODEL_ANTHROPIC,
    };
  }
  return null;
}

function detectMediaType(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  if (buffer.length < 4) return "image/jpeg";
  const b = buffer;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "image/webp";
  return "image/jpeg";
}

/**
 * Parse YYYY-MM-DD or DD/MM/YYYY into a Date at UTC midnight. Returns
 * undefined for anything else so the caller can simply spread the object
 * into form defaults.
 */
function parseLooseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return isNaN(date.getTime()) ? undefined : date;
  }
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y!.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

const LICENCE_SYSTEM = `You are an OCR assistant that reads Australian driver
licences (and lookalike overseas licences) and returns a structured summary.
You must always call the "extract_licence" tool exactly once; never respond
with free text. If a field is illegible or missing, omit it. Set
\`confidence\` to your self-estimate (0 = guessing, 1 = every field crisp).

First classify the image and report it in \`documentType\`, judging by the
document's *function*, not its physical format:
- "DRIVERS_LICENCE" — any driver licence / driving permit, including
  passport-style booklet licences and international driving permits.
- "PASSPORT" — a passport bio-data page.
- "OTHER" — anything else (a selfie, utility bill, blank page, screenshot, or
  any document that is not a licence or a passport).
If \`documentType\` is not "DRIVERS_LICENCE", set \`confidence\` to 0 and omit
every other field — do not guess licence details from a non-licence image.

For \`country\`, report the country that issued the licence (e.g. "Australia"
for any Australian state/territory licence, "New Zealand", "United Kingdom").
Infer it from visible branding (e.g. "New South Wales, Australia" → Australia)
when no explicit country line is printed.

If a residential address is printed on the licence, split it into
\`addressLine1\` (street number + street, e.g. "6 TWEEDMOUTH AVE"),
\`addressLine2\` (unit / suite / care-of line, omit if none), \`suburb\`
(locality, e.g. "ROSEBERY"), \`addressState\` (the STATE portion of the
address line, which may differ from the licence's issuing state), and
\`postcode\`. Preserve the casing as printed. Omit any address fields that
aren't visible — never guess.

When reporting \`faceBoundingBox\`, return the tightest possible passport
headshot crop of the person's face only: top of head (just above the hair)
to chin, left ear to right ear. Never include shoulders, the neck, printed
text (names, numbers, dates), QR codes, holograms, flags, or licence card
background. If you aren't sure a face is present, omit the field.`;

const PASSPORT_SYSTEM = `You are an OCR assistant that reads international
passports and returns a structured summary. You must always call the
"extract_passport" tool exactly once; never respond with free text. Read the
machine-readable zone when available and cross-check the visual fields. If a
field is illegible or missing, omit it. Set \`confidence\` to your
self-estimate (0 = guessing, 1 = every field crisp).

First classify the image and report it in \`documentType\`, judging by the
document's *function*, not its physical format:
- "PASSPORT" — a passport bio-data page.
- "DRIVERS_LICENCE" — any driver licence / driving permit, including
  passport-style booklet licences and international driving permits.
- "OTHER" — anything else (a selfie, utility bill, blank page, screenshot, or
  any document that is not a licence or a passport).
If \`documentType\` is not "PASSPORT", set \`confidence\` to 0 and omit every
other field — do not guess passport details from a non-passport image.`;

const LICENCE_TOOL: Anthropic.Messages.Tool = {
  name: "extract_licence",
  description: "Report the fields extracted from the licence image.",
  input_schema: {
    type: "object",
    properties: {
      licenceNumber: { type: "string", description: "Licence / card number (alphanumeric, no spaces)." },
      state: { type: "string", description: "Issuing state or territory (e.g. NSW, VIC, QLD)." },
      firstName: { type: "string", description: "Given name(s)." },
      lastName: { type: "string", description: "Family name / surname." },
      dateOfBirth: { type: "string", description: "ISO date YYYY-MM-DD if parseable." },
      expiryDate: { type: "string", description: "ISO expiry YYYY-MM-DD if parseable." },
      licenceClass: { type: "string", description: "Licence class / category code, as printed (e.g. 'C', 'C, R LRN')." },
      conditions: { type: "string", description: "Conditions as printed (e.g. 'None', 'S - glasses')." },
      country: { type: "string", description: "Issuing country of the licence (e.g. 'Australia', 'New Zealand')." },
      addressLine1: { type: "string", description: "First line of the printed residential address (street number + street), if visible." },
      addressLine2: { type: "string", description: "Second address line (unit / suite / care-of), if visible. Omit otherwise." },
      suburb: { type: "string", description: "Suburb / locality from the printed address (e.g. 'ROSEBERY')." },
      addressState: { type: "string", description: "State/territory from the address line (may differ from the licence's issuing state)." },
      postcode: { type: "string", description: "Postcode / ZIP from the printed address." },
      faceBoundingBox: {
        type: "object",
        description:
          "Normalised coordinates (0-1) of ONLY the person's face — top of head to chin, ear to ear. Exclude shoulders, neck, hair past the ears, any printed text, names, dates, QR codes, holograms, and licence background. Think passport headshot crop. Omit if no face is visible.",
        properties: {
          x: { type: "number", minimum: 0, maximum: 1, description: "Left edge of face bbox." },
          y: { type: "number", minimum: 0, maximum: 1, description: "Top edge (above eyebrows / hairline)." },
          width: { type: "number", minimum: 0, maximum: 1, description: "Face width, ear-to-ear only." },
          height: { type: "number", minimum: 0, maximum: 1, description: "Top-of-head to chin only; do NOT include shoulders or any text below." },
        },
        required: ["x", "y", "width", "height"],
      },
      documentType: {
        type: "string",
        enum: ["DRIVERS_LICENCE", "PASSPORT", "OTHER"],
        description:
          "What kind of identity document the image actually is, by function: 'DRIVERS_LICENCE' for any driver licence/permit (incl. passport-style booklet licences and IDPs), 'PASSPORT' for a passport bio-data page, 'OTHER' for anything that is not a licence or passport.",
      },
      confidence: {
        type: "number",
        description: "Self-estimated confidence from 0 to 1.",
        minimum: 0,
        maximum: 1,
      },
    },
    required: ["documentType", "confidence"],
  },
};

const INFRINGEMENT_SYSTEM = `You are an OCR assistant that reads Australian
(New South Wales) traffic and parking penalty / infringement notices and
returns a structured summary. You must always call the "extract_infringement"
tool exactly once; never respond with free text. If a field is illegible or
missing, omit it. Set \`confidence\` to your self-estimate (0 = guessing,
1 = every field crisp).

First classify the image in \`documentType\`:
- "PENALTY_NOTICE" — a traffic/camera/parking penalty or infringement notice
  (Revenue NSW, a NSW council, Transport for NSW, etc.).
- "OTHER" — anything that is not a penalty/infringement notice.
If \`documentType\` is not "PENALTY_NOTICE", set \`confidence\` to 0 and omit
every other field.

Field guidance:
- \`penaltyNoticeNumber\`: the penalty/infringement notice number (the unique
  reference, not the camera/offence code).
- \`vehicleRego\`: the vehicle registration plate the notice was issued against.
- \`issuer\`: the issuing authority as printed (e.g. "Revenue NSW",
  "City of Sydney", "Transport for NSW").
- \`offenceCode\` / \`offenceDescription\`: the offence code and its printed
  description.
- \`offenceLocation\`: where the offence occurred, as printed.
- \`offenceDate\`: when the OFFENCE occurred — ISO "YYYY-MM-DD" (include the
  time only if you cannot separate it). \`issueDate\`: when the NOTICE was
  issued — ISO "YYYY-MM-DD". These are often different; do not conflate them.
- \`amount\`: the penalty amount in Australian dollars as a number (e.g. 387).
- \`demeritPoints\`: the number of demerit points, 0 if none shown.
- \`type\`: classify the offence — SPEEDING, PARKING, TOLL, RED_LIGHT,
  MOBILE_PHONE, SEATBELT, UNREGISTERED, or OTHER.`;

const INFRINGEMENT_TOOL: Anthropic.Messages.Tool = {
  name: "extract_infringement",
  description: "Report the fields extracted from the penalty/infringement notice image.",
  input_schema: {
    type: "object",
    properties: {
      penaltyNoticeNumber: { type: "string", description: "Unique penalty/infringement notice number." },
      vehicleRego: { type: "string", description: "Vehicle registration plate on the notice." },
      issuer: { type: "string", description: "Issuing authority as printed." },
      offenceCode: { type: "string", description: "Offence code, as printed." },
      offenceDescription: { type: "string", description: "Offence description, as printed." },
      offenceLocation: { type: "string", description: "Location of the offence, as printed." },
      offenceDate: { type: "string", description: "ISO date YYYY-MM-DD the OFFENCE occurred." },
      issueDate: { type: "string", description: "ISO date YYYY-MM-DD the NOTICE was issued." },
      amount: { type: "number", description: "Penalty amount in AUD as a number." },
      demeritPoints: { type: "number", description: "Demerit points (0 if none)." },
      type: {
        type: "string",
        enum: ["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "MOBILE_PHONE", "SEATBELT", "UNREGISTERED", "OTHER"],
        description: "Offence category.",
      },
      documentType: {
        type: "string",
        enum: ["PENALTY_NOTICE", "OTHER"],
        description: "Whether the image is a penalty/infringement notice or something else.",
      },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Self-estimated confidence 0-1." },
    },
    required: ["documentType", "confidence"],
  },
};

const PASSPORT_TOOL: Anthropic.Messages.Tool = {
  name: "extract_passport",
  description: "Report the fields extracted from the passport image.",
  input_schema: {
    type: "object",
    properties: {
      passportNumber: { type: "string" },
      country: { type: "string", description: "Issuing country name or 3-letter code." },
      firstName: { type: "string" },
      lastName: { type: "string" },
      dateOfBirth: { type: "string", description: "ISO date YYYY-MM-DD if parseable." },
      expiryDate: { type: "string", description: "ISO expiry YYYY-MM-DD if parseable." },
      documentType: {
        type: "string",
        enum: ["DRIVERS_LICENCE", "PASSPORT", "OTHER"],
        description:
          "What kind of identity document the image actually is, by function: 'PASSPORT' for a passport bio-data page, 'DRIVERS_LICENCE' for any driver licence/permit (incl. passport-style booklet licences and IDPs), 'OTHER' for anything that is not a licence or passport.",
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["documentType", "confidence"],
  },
};

type ToolRunArgs = {
  systemPrompt: string;
  tool: Anthropic.Messages.Tool;
  imageBuffer: Buffer;
  model?: string;
};

type VisionToolResult = {
  data: Record<string, unknown> | null;
  usage: OcrUsage | null;
};

async function runVisionTool(args: ToolRunArgs): Promise<VisionToolResult> {
  const provider = getProvider();
  if (!provider) return { data: null, usage: null };
  const model = args.model ?? provider.model;
  if (provider.kind === "anthropic") {
    return runVisionToolAnthropic(provider, model, args);
  }
  return runVisionToolOpenRouter(provider, model, args);
}

async function runVisionToolAnthropic(
  provider: ResolvedProvider,
  model: string,
  args: ToolRunArgs,
): Promise<VisionToolResult> {
  const client = new Anthropic({ apiKey: provider.apiKey });
  const startedAt = performance.now();
  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: args.systemPrompt,
    tools: [args.tool],
    tool_choice: { type: "tool", name: args.tool.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: detectMediaType(args.imageBuffer),
              data: args.imageBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Call ${args.tool.name} with the fields you can read.`,
          },
        ],
      },
    ],
  });

  const usage: OcrUsage = {
    provider: "anthropic",
    model,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    latencyMs: Math.round(performance.now() - startedAt),
  };

  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === args.tool.name) {
      return { data: block.input as Record<string, unknown>, usage };
    }
  }
  return { data: null, usage };
}

async function runVisionToolOpenRouter(
  provider: ResolvedProvider,
  model: string,
  args: ToolRunArgs,
): Promise<VisionToolResult> {
  const openRouter = provider.openRouter!;
  const client = new OpenAI({
    apiKey: provider.apiKey,
    baseURL: openRouter.baseUrl,
    defaultHeaders: {
      "HTTP-Referer": openRouter.httpReferer,
      "X-Title": openRouter.appTitle,
    },
  });

  const mediaType = detectMediaType(args.imageBuffer);
  const dataUrl = `data:${mediaType};base64,${args.imageBuffer.toString("base64")}`;

  const startedAt = performance.now();
  const response = await client.chat.completions.create({
    model,
    max_tokens: 512,
    messages: [
      { role: "system", content: args.systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          {
            type: "text",
            text: `Call ${args.tool.name} with the fields you can read.`,
          },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: args.tool.name,
          description: args.tool.description,
          parameters: args.tool.input_schema as Record<string, unknown>,
        },
      },
    ],
    tool_choice: {
      type: "function",
      function: { name: args.tool.name },
    },
  });

  const openRouterResp = response as unknown as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
    };
  };
  const usage: OcrUsage = {
    provider: "openrouter",
    model,
    inputTokens: openRouterResp.usage?.prompt_tokens ?? 0,
    outputTokens: openRouterResp.usage?.completion_tokens ?? 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    latencyMs: Math.round(performance.now() - startedAt),
    ...(typeof openRouterResp.usage?.cost === "number"
      ? { upstreamCostUsd: openRouterResp.usage.cost }
      : {}),
  };

  const call = response.choices?.[0]?.message?.tool_calls?.find(
    (tc) => tc.type === "function" && tc.function.name === args.tool.name,
  );
  if (!call || call.type !== "function") return { data: null, usage };
  try {
    const parsed = JSON.parse(call.function.arguments);
    return {
      data: typeof parsed === "object" && parsed !== null ? parsed : null,
      usage,
    };
  } catch {
    return { data: null, usage };
  }
}

/**
 * Helper for the public extract functions — captures the vision call's
 * usage into OcrCostLog when a log context is supplied. Always silent on
 * failure; cost tracking must never break the user-visible OCR flow.
 */
async function maybeLogOcr(
  log: OcrLogContext | undefined,
  usage: OcrUsage | null,
  outcome: "SUCCESS" | "LOW_CONFIDENCE" | "NO_MATCH" | "ERROR",
): Promise<void> {
  if (!log || !usage) return;
  const costAud = await recordOcrUsage({ ...log, outcome }, usage);
  // Mirror the call into PostHog LLM observability. distinctId prefers the
  // customer the document belongs to, falling back to the staff member who
  // triggered it. PostHog wants USD; OpenRouter gives it directly, otherwise
  // convert our AUD cost back at the same rate ocr-cost used.
  const distinctId = log.customerId ?? log.triggeredById;
  if (!distinctId) return;
  const costUsd =
    usage.provider === "openrouter" && typeof usage.upstreamCostUsd === "number"
      ? usage.upstreamCostUsd
      : costAud / USD_AUD_RATE;
  await trackAiGeneration({
    distinctId,
    model: usage.model,
    provider: usage.provider,
    feature: "ocr",
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cachedInputTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    ...(usage.latencyMs != null ? { latencySeconds: usage.latencyMs / 1000 } : {}),
    costUsd,
    properties: { kind: log.kind, outcome, triggeredById: log.triggeredById ?? null },
  });
}

/**
 * Extract fields from a driver's licence photo. Returns an empty object (no
 * fields populated) on any failure or low-confidence result — callers use
 * the result as optional pre-fill only.
 */
export async function extractLicenceData(
  imageBuffer: Buffer,
  opts: { model?: string; log?: Omit<OcrLogContext, "kind"> } = {},
): Promise<ExtractLicenceData> {
  const logCtx: OcrLogContext | undefined = opts.log
    ? { ...opts.log, kind: "LICENCE" }
    : undefined;
  try {
    const { data: raw, usage } = await _internal.runVisionTool({
      systemPrompt: LICENCE_SYSTEM,
      tool: LICENCE_TOOL,
      imageBuffer,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    });
    if (!raw) {
      await maybeLogOcr(logCtx, usage, "NO_MATCH");
      return { confidence: 0 };
    }
    const parsed = licenceToolSchema.safeParse(raw);
    if (!parsed.success) {
      await maybeLogOcr(logCtx, usage, "ERROR");
      return { confidence: 0 };
    }
    const documentType = parsed.data.documentType;
    // Wrong document type — the image is not a driver's licence. Surface the
    // classification so callers can decide (accept-and-nudge vs reject), but
    // never pre-fill licence fields from a non-licence image.
    if (documentType && documentType !== "DRIVERS_LICENCE") {
      await maybeLogOcr(logCtx, usage, "NO_MATCH");
      return { documentType, confidence: parsed.data.confidence };
    }
    if (parsed.data.confidence < MIN_CONFIDENCE) {
      await maybeLogOcr(logCtx, usage, "LOW_CONFIDENCE");
      return {
        ...(documentType ? { documentType } : {}),
        confidence: parsed.data.confidence,
      };
    }
    await maybeLogOcr(logCtx, usage, "SUCCESS");
    const dob = parseLooseDate(parsed.data.dateOfBirth);
    const expiry = parseLooseDate(parsed.data.expiryDate);
    return {
      ...(parsed.data.licenceNumber ? { licenceNumber: parsed.data.licenceNumber } : {}),
      ...(parsed.data.state ? { state: parsed.data.state.toUpperCase() } : {}),
      ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(expiry ? { expiryDate: expiry } : {}),
      ...(parsed.data.licenceClass ? { licenceClass: parsed.data.licenceClass } : {}),
      ...(parsed.data.conditions ? { conditions: parsed.data.conditions } : {}),
      ...(parsed.data.country ? { country: parsed.data.country } : {}),
      ...(parsed.data.addressLine1 ? { addressLine1: parsed.data.addressLine1 } : {}),
      ...(parsed.data.addressLine2 ? { addressLine2: parsed.data.addressLine2 } : {}),
      ...(parsed.data.suburb ? { suburb: parsed.data.suburb } : {}),
      ...(parsed.data.addressState ? { addressState: parsed.data.addressState.toUpperCase() } : {}),
      ...(parsed.data.postcode ? { postcode: parsed.data.postcode } : {}),
      ...(parsed.data.faceBoundingBox ? { faceBoundingBox: parsed.data.faceBoundingBox } : {}),
      ...(documentType ? { documentType } : {}),
      confidence: parsed.data.confidence,
    };
  } catch {
    return { confidence: 0 };
  }
}

/**
 * Extract fields from a passport photo (biographic page). Same contract as
 * `extractLicenceData` — empty object on failure, no throws.
 */
export async function extractPassportData(
  imageBuffer: Buffer,
  opts: { model?: string; log?: Omit<OcrLogContext, "kind"> } = {},
): Promise<ExtractPassportData> {
  const logCtx: OcrLogContext | undefined = opts.log
    ? { ...opts.log, kind: "PASSPORT" }
    : undefined;
  try {
    const { data: raw, usage } = await _internal.runVisionTool({
      systemPrompt: PASSPORT_SYSTEM,
      tool: PASSPORT_TOOL,
      imageBuffer,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    });
    if (!raw) {
      await maybeLogOcr(logCtx, usage, "NO_MATCH");
      return { confidence: 0 };
    }
    const parsed = passportToolSchema.safeParse(raw);
    if (!parsed.success) {
      await maybeLogOcr(logCtx, usage, "ERROR");
      return { confidence: 0 };
    }
    const documentType = parsed.data.documentType;
    // Wrong document type — the image is not a passport. Surface the
    // classification so callers can decide (accept-and-nudge vs reject), but
    // never pre-fill passport fields from a non-passport image.
    if (documentType && documentType !== "PASSPORT") {
      await maybeLogOcr(logCtx, usage, "NO_MATCH");
      return { documentType, confidence: parsed.data.confidence };
    }
    if (parsed.data.confidence < MIN_CONFIDENCE) {
      await maybeLogOcr(logCtx, usage, "LOW_CONFIDENCE");
      return {
        ...(documentType ? { documentType } : {}),
        confidence: parsed.data.confidence,
      };
    }
    await maybeLogOcr(logCtx, usage, "SUCCESS");
    const dob = parseLooseDate(parsed.data.dateOfBirth);
    const expiry = parseLooseDate(parsed.data.expiryDate);
    return {
      ...(parsed.data.passportNumber ? { passportNumber: parsed.data.passportNumber } : {}),
      ...(parsed.data.country ? { country: parsed.data.country } : {}),
      ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(expiry ? { expiryDate: expiry } : {}),
      ...(documentType ? { documentType } : {}),
      confidence: parsed.data.confidence,
    };
  } catch {
    return { confidence: 0 };
  }
}

/**
 * Extract fields from a NSW penalty / infringement notice image. Same
 * contract as `extractLicenceData` — empty object (confidence 0) on any
 * failure, never throws, results are pre-fill SUGGESTIONS only. Staff must
 * confirm every field before an Infringement is created (a wrong nomination
 * to Revenue NSW is a criminal offence).
 */
export async function extractInfringementNotice(
  imageBuffer: Buffer,
  opts: { model?: string; log?: Omit<OcrLogContext, "kind"> } = {},
): Promise<ExtractInfringementData> {
  const logCtx: OcrLogContext | undefined = opts.log
    ? { ...opts.log, kind: "INFRINGEMENT" }
    : undefined;
  try {
    const { data: raw, usage } = await _internal.runVisionTool({
      systemPrompt: INFRINGEMENT_SYSTEM,
      tool: INFRINGEMENT_TOOL,
      imageBuffer,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    });
    if (!raw) {
      await maybeLogOcr(logCtx, usage, "NO_MATCH");
      return { confidence: 0 };
    }
    const parsed = infringementToolSchema.safeParse(raw);
    if (!parsed.success) {
      await maybeLogOcr(logCtx, usage, "ERROR");
      return { confidence: 0 };
    }
    const documentType = parsed.data.documentType;
    if (documentType && documentType !== "PENALTY_NOTICE") {
      await maybeLogOcr(logCtx, usage, "NO_MATCH");
      return { documentType, confidence: parsed.data.confidence };
    }
    if (parsed.data.confidence < MIN_CONFIDENCE) {
      await maybeLogOcr(logCtx, usage, "LOW_CONFIDENCE");
      return {
        ...(documentType ? { documentType } : {}),
        confidence: parsed.data.confidence,
      };
    }
    await maybeLogOcr(logCtx, usage, "SUCCESS");
    const offenceDate = parseLooseDate(parsed.data.offenceDate);
    const issueDate = parseLooseDate(parsed.data.issueDate);
    return {
      ...(parsed.data.penaltyNoticeNumber ? { penaltyNoticeNumber: parsed.data.penaltyNoticeNumber } : {}),
      ...(parsed.data.vehicleRego ? { vehicleRego: parsed.data.vehicleRego.toUpperCase() } : {}),
      ...(parsed.data.issuer ? { issuer: parsed.data.issuer } : {}),
      ...(parsed.data.offenceCode ? { offenceCode: parsed.data.offenceCode } : {}),
      ...(parsed.data.offenceDescription ? { offenceDescription: parsed.data.offenceDescription } : {}),
      ...(parsed.data.offenceLocation ? { offenceLocation: parsed.data.offenceLocation } : {}),
      ...(offenceDate ? { offenceDate } : {}),
      ...(issueDate ? { issueDate } : {}),
      ...(typeof parsed.data.amount === "number" ? { amount: parsed.data.amount } : {}),
      ...(typeof parsed.data.demeritPoints === "number" ? { demeritPoints: parsed.data.demeritPoints } : {}),
      ...(parsed.data.type ? { type: parsed.data.type } : {}),
      ...(documentType ? { documentType } : {}),
      confidence: parsed.data.confidence,
    };
  } catch {
    return { confidence: 0 };
  }
}

/** Internal — exposed so tests can replace the outbound call without network. */
export const _internal = {
  parseLooseDate,
  detectMediaType,
  runVisionTool,
  getProvider,
};
