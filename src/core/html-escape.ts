export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Every href this renderer emits from report data is a fragment-only internal anchor
// (#control-CTRL-001, #finding-FND-001); this allow-list is defense-in-depth per spec §8.1,
// not something the current renderer's own hrefs require beyond the fragment case.
export function escapeUrlAttribute(value: string): string {
  if (value.startsWith("#")) return escapeHtmlAttribute(value);
  try {
    const url = new URL(value);
    if (SAFE_URL_PROTOCOLS.has(url.protocol)) return escapeHtmlAttribute(value);
  } catch {
    // not a parseable absolute URL — falls through to the safe fallback below
  }
  return "#";
}

const LINE_SEPARATOR = " ";
const PARAGRAPH_SEPARATOR = " ";

const SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  [LINE_SEPARATOR]: "\\u2028",
  [PARAGRAPH_SEPARATOR]: "\\u2029",
};

const SCRIPT_ESCAPE_PATTERN = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g");

export function escapeForInlineScriptJson(json: string): string {
  return json.replace(SCRIPT_ESCAPE_PATTERN, (ch) => SCRIPT_ESCAPES[ch]);
}
