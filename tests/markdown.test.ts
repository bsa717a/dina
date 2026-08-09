import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownText } from "@/lib/client/markdown";

function html(text: string) {
  return renderToStaticMarkup(createElement(MarkdownText, { text }));
}

describe("MarkdownText", () => {
  it("renders headings instead of raw hash markers", () => {
    const out = html("# Morning brief\n\n## Validation Gate");
    expect(out).toContain("<h1");
    expect(out).toContain("Morning brief");
    expect(out).toContain("<h2");
    expect(out).toContain("Validation Gate");
    expect(out).not.toContain("# Morning brief");
  });

  it("renders bold, lists, and markdown links", () => {
    const out = html(
      "**Summary:** hello\n\n- item one\n\nSee [Alma 12](https://example.com/alma-12)",
    );
    expect(out).toContain("<strong");
    expect(out).toContain("Summary:");
    expect(out).toContain("<ul");
    expect(out).toContain("<li");
    expect(out).toContain('href="https://example.com/alma-12"');
    expect(out).toContain(">Alma 12<");
    expect(out).toContain('target="_blank"');
  });

  it("does not render raw HTML", () => {
    const out = html('Hello <script>alert(1)</script>');
    expect(out).not.toContain("<script>");
  });
});
