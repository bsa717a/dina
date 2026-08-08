import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkifiedText } from "@/lib/client/linkify";

function html(text: string, isUser = false) {
  return renderToStaticMarkup(createElement(LinkifiedText, { text, isUser }));
}

describe("LinkifiedText", () => {
  it("linkifies bare https URLs", () => {
    const out = html("Open https://example.com/a?x=1 now");
    expect(out).toContain('href="https://example.com/a?x=1"');
    expect(out).toContain("target=\"_blank\"");
    expect(out).toContain("Open ");
    expect(out).toContain(" now");
  });

  it("renders markdown links with labels", () => {
    const out = html("See [EQ Temple Lesson.docx](https://4studentlives-my.sharepoint.com/:w:/p/derek/abc)");
    expect(out).toContain('href="https://4studentlives-my.sharepoint.com/:w:/p/derek/abc"');
    expect(out).toContain(">EQ Temple Lesson.docx<");
  });

  it("does not swallow trailing sentence punctuation", () => {
    const out = html("Done: https://example.com/file.docx.");
    expect(out).toContain('href="https://example.com/file.docx"');
    expect(out).toContain("</a>.");
  });
});
