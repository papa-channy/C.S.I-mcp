import { describe, expect, it } from "vitest";
import { escapeHtmlText, escapeHtmlAttribute, escapeUrlAttribute, escapeForInlineScriptJson } from "../../src/core/html-escape.js";

describe("escapeHtmlText", () => {
  it("escapes <, >, and &", () => {
    expect(escapeHtmlText("<script>alert(1)</script> & co")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
  });

  it("leaves quotes untouched (not needed in text node context)", () => {
    expect(escapeHtmlText(`it's "fine"`)).toBe(`it's "fine"`);
  });
});

describe("escapeHtmlAttribute", () => {
  it("escapes <, >, &, \", and '", () => {
    expect(escapeHtmlAttribute(`<a href="x">it's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;it&#39;s&lt;/a&gt;");
  });
});

describe("escapeUrlAttribute", () => {
  it("allows a fragment-only href unchanged (just attribute-escaped)", () => {
    expect(escapeUrlAttribute("#control-CTRL-001")).toBe("#control-CTRL-001");
  });

  it("allows http/https/mailto absolute URLs", () => {
    expect(escapeUrlAttribute("https://example.com/x")).toBe("https://example.com/x");
    expect(escapeUrlAttribute("mailto:a@example.com")).toBe("mailto:a@example.com");
  });

  it("neutralizes a javascript: URL to a safe fragment", () => {
    expect(escapeUrlAttribute("javascript:alert(1)")).toBe("#");
  });

  it("neutralizes an unparseable string to a safe fragment", () => {
    expect(escapeUrlAttribute("not a url at all")).toBe("#");
  });
});

describe("escapeForInlineScriptJson", () => {
  it("replaces <, >, &, U+2028, U+2029 with their literal 6-character \\uXXXX escape sequences", () => {
    const input = JSON.stringify({ x: "</script><script>&  " });
    const result = escapeForInlineScriptJson(input);
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("&");
    expect(result).not.toContain(" ");
    expect(result).not.toContain(" ");
    expect(result).toContain("\\u003c");
    expect(result).toContain("\\u003e");
    expect(result).toContain("\\u0026");
    expect(result).toContain("\\u2028");
    expect(result).toContain("\\u2029");
  });

  it("the escaped output, when embedded as a JS string literal and evaluated, reconstructs the original JSON text", () => {
    const original = { title: "</script><script>alert(1)</script> payload" };
    const originalJson = JSON.stringify(original);
    const escaped = escapeForInlineScriptJson(originalJson);
    const reconstructed = new Function(`return "${escaped.replace(/"/g, '\\"')}";`)();
    expect(JSON.parse(reconstructed)).toEqual(original);
  });

  it("leaves ordinary JSON content (no special characters) unchanged", () => {
    const input = JSON.stringify({ a: 1, b: "plain text" });
    expect(escapeForInlineScriptJson(input)).toBe(input);
  });
});
