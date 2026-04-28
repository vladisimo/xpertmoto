import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { getSupportConfig } from "@/lib/support-config";
import {
  getSupportAIProvider,
  SupportAIUnavailableError,
  SUPPORT_AI_TOOLS,
  scrubCardDigits,
  mentionsMoneyDispute,
  mentionsRoadsideBreakdown,
  type SupportAIMessage,
} from "@/server/services/support-ai";
import { buildSupportFaqText } from "@/server/services/support-faq";
import { getBranding } from "@/lib/branding";
import { recordUsage, rollingDailyCostAud } from "@/server/services/support-cost";
import { routeTicket } from "@/server/services/support-routing";
import { enqueueSupportNotify } from "@/server/jobs/support-notify";
import { generateTicketNumber } from "@/server/services/support-ticket-number";

const BodySchema = z.object({
  conversationId: z.string(),
  message: z.string().min(1).max(4000),
});

export async function POST(req: NextRequest): Promise<Response> {
  const cfg = getSupportConfig();
  if (!cfg.enabled) {
    return NextResponse.json({ error: "Support disabled" }, { status: 503 });
  }
  if (!cfg.aiEnabled) {
    return NextResponse.json({ error: "AI disabled — use structured form" }, { status: 503 });
  }

  // Cost-cap guard: if we've burned through the daily AUD budget, short-circuit
  // with a graceful fallback so the widget can suggest the form path.
  const spent24h = await rollingDailyCostAud(prisma);
  if (spent24h >= cfg.costCapAudDaily) {
    logger.warn({ spent24h, cap: cfg.costCapAudDaily }, "support AI cost cap hit");
    return NextResponse.json(
      { error: "AI temporarily unavailable — please use the form." },
      { status: 503 },
    );
  }

  let parsed;
  try {
    const json = (await req.json()) as unknown;
    parsed = BodySchema.parse(json);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const conv = await prisma.supportConversation.findUnique({
    where: { id: parsed.conversationId },
    include: {
      messages: {
        orderBy: { createdAt: "asc" },
        take: 40, // cap history
      },
      booking: true,
      customer: { select: { id: true, firstName: true } },
      depot: true,
    },
  });
  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Guest conversations use a signed cookie check; authed users must own
  // the conversation (or staff may view — staff don't use this route).
  const session = await auth();
  if (conv.customerId && session?.user?.id !== conv.customerId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scrub card digits before anything else. Keep scrubbed text for the
  // model; keep the (unscrubbed) original just for detection — but we
  // scrub on persist as well.
  const scrubbedBody = scrubCardDigits(parsed.message);
  const triggeredPaymentGuard = mentionsMoneyDispute(parsed.message);
  const triggeredRoadsideGuard = mentionsRoadsideBreakdown(parsed.message);

  // Persist the user's turn immediately (scrubbed copy).
  await prisma.supportMessage.create({
    data: {
      conversationId: conv.id,
      senderRole: "CUSTOMER",
      body: scrubbedBody,
    },
  });
  await prisma.supportConversation.update({
    where: { id: conv.id },
    data: { lastMessageAt: new Date() },
  });

  // Build context for the system prompt.
  const contextLines: string[] = [];
  if (conv.customer) {
    contextLines.push(`Customer first name: ${conv.customer.firstName}`);
  } else if (conv.guestName) {
    contextLines.push(`Guest name: ${conv.guestName}`);
  }
  if (conv.booking) {
    contextLines.push(
      `Active booking: ${conv.booking.bookingReference}, status ${conv.booking.status}, pickup ${conv.booking.pickupDateTime.toISOString()}`,
    );
  }
  if (conv.depot) {
    contextLines.push(`Depot context: ${conv.depot.name} (timezone ${conv.depot.timezone})`);
  }

  const supportBranding = await getBranding();
  const system =
    buildSupportFaqText({
      siteName: supportBranding.siteName,
      legalName: supportBranding.legalName,
      abn: supportBranding.abn,
    }) +
    (contextLines.length > 0 ? `\n\n## Current session context\n${contextLines.join("\n")}` : "");

  const historyMessages: SupportAIMessage[] = conv.messages
    .filter((m) => m.senderRole === "CUSTOMER" || m.senderRole === "AI")
    .map((m) => ({
      role: m.senderRole === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
      content: m.body,
    }));
  historyMessages.push({ role: "user", content: scrubbedBody });

  // If the message looks like a dispute, force-create a PAYMENT ticket and
  // return a canned response rather than letting the AI commit to money.
  if (triggeredPaymentGuard) {
    const created = await createTicketFromChat({
      conversationId: conv.id,
      category: "PAYMENT",
      summary: "Customer raised a refund / billing dispute in chat.",
      description: scrubbedBody,
      urgency: false,
    });
    const canned = `Thanks — I've raised ticket ${created.ticketNumber} with our finance team. They'll be in touch by email. I can't discuss specific amounts in chat.`;
    await prisma.supportMessage.create({
      data: {
        conversationId: conv.id,
        senderRole: "SYSTEM",
        body: canned,
        toolCalls: [{ ticketNumber: created.ticketNumber, category: "PAYMENT" }] as never,
      },
    });
    return new Response(
      new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ type: "delta", text: canned })}\n\n` +
                `data: ${JSON.stringify({ type: "tool_result", name: "create_ticket", ticketNumber: created.ticketNumber, category: "PAYMENT" })}\n\n` +
                `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        },
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  let provider;
  try {
    provider = getSupportAIProvider(cfg);
  } catch (err) {
    if (err instanceof SupportAIUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  // Stream SSE to the client. We collect the full assistant turn as we
  // go so we can persist it on completion.
  const encoder = new TextEncoder();
  let assistantBuffer = "";
  const ticketSummaries: Array<{ ticketNumber: string; category: string }> = [];

  const stream = new ReadableStream({
    async start(controller) {
      function emit(obj: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      try {
        const iter = provider.streamChat({
          system,
          messages: historyMessages,
          tools: SUPPORT_AI_TOOLS,
        });

        for await (const chunk of iter) {
          if (chunk.kind === "text") {
            assistantBuffer += chunk.delta;
            emit({ type: "delta", text: chunk.delta });
          } else if (chunk.kind === "tool_use") {
            const tc = chunk.toolCall;
            if (tc.name === "create_ticket") {
              const category =
                typeof tc.input.category === "string"
                  ? tc.input.category
                  : "GENERAL";
              const summary =
                typeof tc.input.summary === "string" ? tc.input.summary : "Support request";
              const urgency =
                tc.input.urgency === true ||
                (triggeredRoadsideGuard && category !== "PAYMENT");
              const created = await createTicketFromChat({
                conversationId: conv.id,
                category: category as never,
                summary,
                description: scrubbedBody,
                urgency,
              });
              ticketSummaries.push({
                ticketNumber: created.ticketNumber,
                category: String(category),
              });
              emit({
                type: "tool_result",
                name: tc.name,
                ticketNumber: created.ticketNumber,
                category,
              });
            } else if (tc.name === "escalate_to_human") {
              emit({ type: "tool_result", name: tc.name, ok: true });
            }
          } else if (chunk.kind === "usage") {
            const costAud = await recordUsage(prisma, conv.id, chunk.usage);
            emit({ type: "usage", costAud });
          }
        }
        emit({ type: "done" });
      } catch (err) {
        logger.error({ err, conversationId: conv.id }, "support stream failed");
        emit({ type: "error", message: "Upstream AI error" });
      } finally {
        if (assistantBuffer.length > 0) {
          await prisma.supportMessage.create({
            data: {
              conversationId: conv.id,
              senderRole: "AI",
              body: assistantBuffer,
              toolCalls: ticketSummaries.length
                ? (ticketSummaries as never)
                : undefined,
            },
          });
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

async function createTicketFromChat(args: {
  conversationId: string;
  category: "BREAKDOWN" | "ABANDONED_VEHICLE" | "PAYMENT" | "GENERAL";
  summary: string;
  description: string;
  urgency: boolean;
}): Promise<{ ticketNumber: string; ticketId: string }> {
  const conv = await prisma.supportConversation.findUniqueOrThrow({
    where: { id: args.conversationId },
  });
  const routing = await routeTicket(prisma, {
    category: args.category,
    body: args.description,
    summary: args.summary,
    bookingId: conv.bookingId,
    customerId: conv.customerId,
    userMarkedUrgent: args.urgency,
  });
  const ticketNumber = await generateTicketNumber(prisma);
  const created = await prisma.supportTicket.create({
    data: {
      ticketNumber,
      conversationId: args.conversationId,
      category: args.category,
      priority: routing.priority,
      depotId: routing.depotId,
      assigneeId: routing.assigneeId,
      customerId: conv.customerId,
      linkedBookingId: conv.bookingId,
      summary: args.summary,
      description: args.description,
      status: routing.assigneeId ? "ASSIGNED" : "OPEN",
    },
  });
  await enqueueSupportNotify(
    { ticketId: created.id, event: "ticket_created" },
    { priorityJob: routing.priority === "URGENT" },
  );
  return { ticketNumber, ticketId: created.id };
}
