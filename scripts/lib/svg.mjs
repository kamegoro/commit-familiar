// Filesystem I/O: rendering the fixed rig template with part content
// substituted in, and auto-embedding the result into a README between
// marker comments. Paths are explicit function parameters (not read from
// env/module-level constants) specifically so tests can point these at
// temporary fixtures instead of the real project files.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATE_PATH = join(__dirname, "..", "..", "rig", "template.svg");

export const README_MARKER_START = "<!-- COMMIT-FAMILIAR:START -->";
export const README_MARKER_END = "<!-- COMMIT-FAMILIAR:END -->";

export function renderSvg(parts, templatePath = DEFAULT_TEMPLATE_PATH) {
  let svg = readFileSync(templatePath, "utf8");
  svg = svg
    .replace("{{BODY}}", parts["body-slot"] || "")
    .replace("{{EYES}}", parts["eyes-slot"] || "")
    .replace("{{MOUTH}}", parts["mouth-slot"] || "")
    .replace("{{HAT}}", parts["hat-slot"] || "")
    .replace("{{ARMOR}}", parts["armor-slot"] || "")
    .replace("{{SHOES}}", parts["shoes-slot"] || "");
  return svg;
}

// Default display width in the README, in CSS pixels. Markdown image
// syntax (![alt](path)) can't set an explicit size, and without one, an
// SVG with no width/height attribute of its own (see rig/template.svg)
// falls back to browser-dependent replaced-element sizing that rendered
// much larger than intended in practice (user feedback, 2026-07-06:
// "デカすぎる" -- too big). An HTML <img width="..."> tag makes the
// display size explicit and configurable instead of leaving it to
// whatever a renderer's default happens to be.
export const DEFAULT_DISPLAY_WIDTH = 140;

// Auto-embeds the character into a README between two marker comments, so
// setup is "paste two marker lines once" rather than "remember to add an
// <img> tag and keep it pointed at the right path". No-ops (with a hint)
// if the markers aren't present, rather than guessing where to insert
// into a README it doesn't otherwise understand -- this is meant to sit
// as a small aside next to other README content, not to take over the
// file's layout. Returns a status string instead of logging directly, so
// tests can assert on the outcome without capturing stdout.
export function injectIntoReadme(readmePath, svgPath, displayWidth = DEFAULT_DISPLAY_WIDTH) {
  if (!existsSync(readmePath)) return "readme-missing";
  const readme = readFileSync(readmePath, "utf8");
  const startIdx = readme.indexOf(README_MARKER_START);
  const endIdx = readme.indexOf(README_MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return "markers-not-found";
  const before = readme.slice(0, startIdx + README_MARKER_START.length);
  const after = readme.slice(endIdx);
  const block = `\n<img src="./${svgPath}" width="${displayWidth}" alt="familiar" />\n`;
  writeFileSync(readmePath, `${before}${block}${after}`);
  return "updated";
}
