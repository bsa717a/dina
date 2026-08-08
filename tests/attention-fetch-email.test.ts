import { describe, expect, it } from "vitest";
import { canViewAttentionEmail } from "@/lib/attention/fetch-email";
import { graphIdFromSourceId } from "@/lib/attention/send";

describe("attention email view", () => {
  it("only enables full view for email sources", () => {
    expect(canViewAttentionEmail("email")).toBe(true);
    expect(canViewAttentionEmail("github")).toBe(false);
    expect(canViewAttentionEmail("calendar")).toBe(false);
  });

  it("strips microsoft365 email prefix for Graph ids", () => {
    expect(graphIdFromSourceId("microsoft365:email:AAMkAGI2")).toBe("AAMkAGI2");
  });
});
