import { describe, expect, it } from "vitest";
import { graphIdFromSourceId } from "@/lib/attention/send";

describe("attention mark-handled helpers", () => {
  it("extracts graph message ids for email mark-read", () => {
    expect(graphIdFromSourceId("microsoft365:email:AAMkAGI=")).toBe(
      "AAMkAGI=",
    );
  });
});
