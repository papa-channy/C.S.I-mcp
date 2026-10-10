import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Regression guard for the "build output cannot start the server" incident: src/mcp/server.ts's
// readD3Source() resolves d3.v7.min.js relative to the *compiled* dist/mcp/server.js location
// (join(__dirname, "..", "assets", "d3.v7.min.js") => dist/assets/d3.v7.min.js), but
// `tsc -p tsconfig.build.json` alone only compiles .ts files — it never copies src/assets/ into
// dist/. Without an explicit copy step, `npm run build && npm start` throws ENOENT before a
// single MCP tool registers. This test asserts the build script still contains that copy step,
// so a future edit that drops it fails fast here instead of silently shipping a broken dist/.
describe("package.json build script — vendored assets reach dist/", () => {
  it("copies src/assets/d3.v7.min.js into dist/assets/ as part of `npm run build`", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { scripts: Record<string, string> };
    const buildScript = pkg.scripts.build;
    expect(buildScript).toContain("dist/assets");
    expect(buildScript).toContain("src/assets/d3.v7.min.js");
  });
});
