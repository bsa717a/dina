import { describe, expect, it } from "vitest";
import {
  annotateToolOutput,
  isMutatingTool,
} from "@/lib/ai/action-receipts";

describe("action receipts", () => {
  it("treats OneDrive and send tools as mutating", () => {
    expect(isMutatingTool("move_onedrive_item")).toBe(true);
    expect(isMutatingTool("write_onedrive_file")).toBe(true);
    expect(isMutatingTool("send_email")).toBe(true);
    expect(isMutatingTool("get_onedrive_item")).toBe(false);
    expect(isMutatingTool("list_calendar_events")).toBe(false);
  });

  it("annotates successful mutating tool output", () => {
    const out = annotateToolOutput(
      "move_onedrive_item",
      JSON.stringify({
        ok: true,
        data: { path: "projects/x.md", verified: true },
      }),
    );
    const parsed = JSON.parse(out) as { ok: boolean; instruction: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.instruction).toMatch(/ACTION RECEIPT/);
    expect(parsed.instruction).toMatch(/SUCCEEDED/);
  });

  it("annotates failed mutating tool output and forbids claiming success", () => {
    const out = annotateToolOutput(
      "write_onedrive_file",
      JSON.stringify({ ok: false, error: "404 not found" }),
    );
    const parsed = JSON.parse(out) as { ok: boolean; instruction: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.instruction).toMatch(/FAILED/);
    expect(parsed.instruction).toMatch(/Do NOT claim/);
  });

  it("treats ok=true with verified=false as unconfirmed, not succeeded", () => {
    const out = annotateToolOutput(
      "copy_onedrive_item",
      JSON.stringify({
        ok: true,
        data: { queued: true, verified: false, newPath: "projects/x.md" },
      }),
    );
    const parsed = JSON.parse(out) as { ok: boolean; instruction: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.instruction).toMatch(/verified=false/);
    expect(parsed.instruction).toMatch(/Do NOT tell Derek the action is finished/);
    expect(parsed.instruction).not.toMatch(/SUCCEEDED/);
  });

  it("leaves read tools unchanged", () => {
    const raw = JSON.stringify({ ok: true, data: { items: [] } });
    expect(annotateToolOutput("search_onedrive", raw)).toBe(raw);
  });

  it("wraps non-JSON mutating output as failure", () => {
    const out = annotateToolOutput("send_email", "not-json");
    const parsed = JSON.parse(out) as { ok: boolean; instruction: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.instruction).toMatch(/FAILED/);
  });
});
