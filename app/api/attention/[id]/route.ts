import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { createAttentionBlock } from "@/lib/attention/blocks";
import { closeAttentionItem } from "@/lib/attention/close";
import {
  attentionProviderFromSourceId,
  providerIdFromSourceId,
} from "@/lib/attention/provider";
import { reviseAttentionDraft } from "@/lib/attention/revise";
import { generateAttentionDraft } from "@/lib/attention/generate-draft";
import { snoozeAttentionItem } from "@/lib/attention/snooze";
import {
  getAttentionItem,
  persistGeneratedDraft,
  recordAttentionAction,
  updateAttentionItemContent,
  updateAttentionItemStatus,
} from "@/lib/attention/store";
import {
  canSendAttentionDraft,
  graphIdFromSourceId,
  recipientFromAttentionRaw,
} from "@/lib/attention/send";
import { getGmailMessage, sendGmailMessage } from "@/lib/google/gmail";
import { forbidden, jsonError, unauthorized } from "@/lib/http";
import { scheduleLearnFromAttentionAction } from "@/lib/learning/distill";
import { graphRequest, userPath } from "@/lib/microsoft/graph";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

const patchSchema = z.object({
  action: z.enum([
    "reviewed",
    "accepted_recommendation",
    "edited_draft",
    "revise_draft",
    "generate_draft",
    "send_draft",
    "dismissed_unimportant",
    "blocked_sender",
    "ignored_notification",
    "snoozed",
  ]),
  draftSubject: z.string().max(500).optional(),
  draftBody: z.string().max(20_000).optional(),
  note: z.string().max(4_000).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireSession();
  if (!user) return unauthorized();
  if (user.role !== "owner") return forbidden();
  const { id } = await context.params;
  const item = await getAttentionItem(id);
  if (!item) return jsonError("Attention item not found.", 404);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) return jsonError("Invalid attention action.");

  const { action, draftSubject, draftBody, note } = parsed.data;

  if (action === "edited_draft" || action === "send_draft") {
    if (draftSubject !== undefined || draftBody !== undefined) {
      await updateAttentionItemStatus(item.id, item.status, {
        draftSubject: draftSubject ?? item.draftSubject ?? undefined,
        draftBody: draftBody ?? item.draftBody ?? undefined,
      });
    }
  }

  if (action === "edited_draft") {
    const details = {
      draftSubject,
      draftBody,
      priorDraftBody: item.draftBody,
    };
    await recordAttentionAction({
      attentionItemId: item.id,
      action: "edited_draft",
      details,
    });
    scheduleLearnFromAttentionAction({
      attentionItemId: item.id,
      action: "edited_draft",
      details,
    });
    const updated = await getAttentionItem(item.id);
    return NextResponse.json({ ok: true, item: updated });
  }

  if (action === "revise_draft") {
    try {
      const revised = await reviseAttentionDraft({
        item,
        draftSubject:
          draftSubject ?? item.draftSubject ?? `Re: ${item.subject || ""}`,
        draftBody: draftBody ?? item.draftBody ?? "",
        note,
      });
      const updated = await updateAttentionItemContent(item.id, {
        summary: revised.summary,
        whyItMatters: revised.whyItMatters,
        recommendedAction: revised.recommendedAction,
        draftSubject: revised.draftSubject,
        draftBody: revised.draftBody,
        shouldDraftReply: true,
      });
      const details = {
        note: note || null,
        revised,
        priorDraftBody: item.draftBody,
        draftSubject: revised.draftSubject,
        draftBody: revised.draftBody,
      };
      await recordAttentionAction({
        attentionItemId: item.id,
        action: "revise_draft",
        details,
      });
      scheduleLearnFromAttentionAction({
        attentionItemId: item.id,
        action: "revise_draft",
        details,
      });
      return NextResponse.json({ ok: true, item: updated });
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "AI revise failed.",
        500,
      );
    }
  }

  if (action === "generate_draft") {
    try {
      if (item.draftBody?.trim()) {
        const updated = await persistGeneratedDraft(item.id, {
          draftSubject: item.draftSubject,
          draftBody: item.draftBody,
        });
        return NextResponse.json({ ok: true, item: updated });
      }
      const draft = await generateAttentionDraft(item);
      const updated = await persistGeneratedDraft(item.id, draft);
      return NextResponse.json({ ok: true, item: updated });
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "Draft failed.",
        500,
      );
    }
  }

  if (action === "snoozed") {
    if (item.status !== "open") {
      return jsonError("Only open Attention items can be snoozed.");
    }
    const updated = await snoozeAttentionItem(item);
    return NextResponse.json({ ok: true, item: updated });
  }

  if (action === "dismissed_unimportant") {
    await closeAttentionItem(item, "dismissed", "dismissed_unimportant");
    return NextResponse.json({ ok: true });
  }

  if (action === "blocked_sender") {
    if (item.source !== "email") {
      return jsonError("Only email Attention items can block a sender.");
    }
    const target = recipientFromAttentionRaw(item.rawJson, item.sender);
    if (!target) {
      return jsonError("Could not determine sender email to block.");
    }
    const block = await createAttentionBlock({
      target,
      reason: note || `Blocked from Attention card: ${item.subject || item.id}`,
      source: "ui",
    });
    await closeAttentionItem(item, "dismissed", "blocked_sender", {
      blocked: block,
    });
    return NextResponse.json({ ok: true, blocked: block });
  }

  if (action === "ignored_notification") {
    await recordAttentionAction({
      attentionItemId: item.id,
      action: "ignored_notification",
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "reviewed") {
    await recordAttentionAction({
      attentionItemId: item.id,
      action: "reviewed",
    });
    const updated = await getAttentionItem(item.id);
    return NextResponse.json({ ok: true, item: updated });
  }

  if (action === "accepted_recommendation") {
    await closeAttentionItem(item, "resolved", "accepted_recommendation");
    return NextResponse.json({ ok: true });
  }

  if (action === "send_draft") {
    if (!canSendAttentionDraft(item.source)) {
      return jsonError(
        "Only email/meeting drafts can be sent from Attention Engine. GitHub drafts are notes — copy them or mark Done.",
      );
    }
    const subject = draftSubject ?? item.draftSubject;
    const body = draftBody ?? item.draftBody;
    if (!body?.trim()) return jsonError("Draft body is empty.");

    const fromAddress = recipientFromAttentionRaw(item.rawJson, item.sender);
    const provider = attentionProviderFromSourceId(item.sourceId);
    const resourceId =
      providerIdFromSourceId(item.sourceId) || graphIdFromSourceId(item.sourceId);

    try {
      if (provider === "google") {
        if (!fromAddress) {
          return jsonError(
            "Could not determine recipient email for this personal Google draft.",
          );
        }
        let threadId: string | undefined;
        let inReplyTo: string | undefined;
        if (item.source === "email") {
          try {
            const original = await getGmailMessage(resourceId, "metadata", [
              "Message-ID",
              "Message-Id",
            ]);
            threadId = original.threadId;
            const headers = original.payload?.headers || [];
            inReplyTo =
              headers.find((h) => (h.name || "").toLowerCase() === "message-id")
                ?.value || undefined;
          } catch {
            // still send as new mail
          }
        }
        await sendGmailMessage({
          to: fromAddress,
          subject: subject || `Re: ${item.subject || ""}`,
          body: body.trim(),
          threadId,
          inReplyTo,
          references: inReplyTo,
        });
      } else if (item.source === "email") {
        // Reply on the original message when possible; otherwise compose new mail.
        // Never fall back to sendMail after createReply succeeded — that can
        // duplicate outbound mail and leave an orphaned draft.
        let replyDraftId: string | null = null;
        try {
          const reply = await graphRequest<{ id?: string }>(
            userPath(`/messages/${encodeURIComponent(resourceId)}/createReply`),
            {
              method: "POST",
              body: { comment: body },
            },
          );

          if (!reply.id) {
            throw new Error("createReply returned no draft id");
          }
          replyDraftId = reply.id;

          await graphRequest(
            userPath(`/messages/${encodeURIComponent(reply.id)}`),
            {
              method: "PATCH",
              body: {
                subject: subject || `Re: ${item.subject || ""}`,
                body: { contentType: "Text", content: body },
              },
            },
          );
          await graphRequest(
            userPath(`/messages/${encodeURIComponent(reply.id)}/send`),
            { method: "POST" },
          );
        } catch (replyError) {
          if (replyDraftId) {
            throw replyError instanceof Error
              ? replyError
              : new Error("Failed after creating reply draft; not sending a second message.");
          }
          if (!fromAddress) {
            throw replyError instanceof Error
              ? replyError
              : new Error("Could not reply to email and no recipient found.");
          }
          await graphRequest(userPath("/sendMail"), {
            method: "POST",
            body: {
              message: {
                subject: subject || `Re: ${item.subject || ""}`,
                body: { contentType: "Text", content: body },
                toRecipients: [{ emailAddress: { address: fromAddress } }],
              },
              saveToSentItems: true,
            },
          });
        }
      } else {
        // Meeting / calendar drafts are composed as new outbound email.
        if (!fromAddress) {
          return jsonError(
            "Could not determine recipient email for this meeting draft. Add the address in the draft or reply from Outlook.",
          );
        }
        await graphRequest(userPath("/sendMail"), {
          method: "POST",
          body: {
            message: {
              subject: subject || `Re: ${item.subject || ""}`,
              body: { contentType: "Text", content: body },
              toRecipients: [{ emailAddress: { address: fromAddress } }],
            },
            saveToSentItems: true,
          },
        });
      }

      await closeAttentionItem(item, "sent", "sent_draft", {
        subject,
        body,
        to: fromAddress || null,
      });
      return NextResponse.json({ ok: true, sent: true });
    } catch (error) {
      logger.error("attention_send_draft_failed", {
        itemId: item.id,
        source: item.source,
        error: error instanceof Error ? error.message : "unknown",
      });
      return jsonError(
        error instanceof Error ? error.message : "Failed to send draft.",
        500,
      );
    }
  }

  return jsonError("Unsupported action.");
}
