#!/usr/bin/env node
// Dev tool: takes a hand-written response (produced by a Claude Code
// session acting as the model, per dry-run-prompt.mjs) and finishes the
// run through the exact same lib/ functions and exact same production
// file paths that a real API-backed run would use (familiar.svg,
// .familiar-parts.json, .familiar-traits.json, .familiar-state.json,
// README embedding). This is what makes the dry run a real end-to-end
// pipeline check rather than a one-off script.
//
// Usage: node scripts/dry-run-apply.mjs <path-to-response-json>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extractJsonObject } from "./lib/parts.mjs";
import { renderSvg, injectIntoReadme, DEFAULT_DISPLAY_WIDTH } from "./lib/svg.mjs";
import { loadJson, saveJson } from "./lib/json-store.mjs";
import { DRYRUN_META_PATH } from "./dry-run-prompt.mjs";

export function loadConfig(env = process.env) {
  return {
    svgPath: env.FAMILIAR_SVG_PATH || "familiar.svg",
    partsPath: env.FAMILIAR_PARTS_PATH || ".familiar-parts.json",
    traitsPath: env.FAMILIAR_TRAITS_PATH || ".familiar-traits.json",
    statePath: env.FAMILIAR_STATE_PATH || ".familiar-state.json",
    readmePath: env.FAMILIAR_README_PATH || "README.md",
    metaPath: env.FAMILIAR_DRYRUN_META_PATH || DRYRUN_META_PATH,
    displayWidth: parseInt(env.FAMILIAR_DISPLAY_WIDTH || String(DEFAULT_DISPLAY_WIDTH), 10),
  };
}

export function applyDryRunResponse(responseText, meta, config) {
  const parsed = extractJsonObject(responseText);

  let parts = loadJson(config.partsPath, null);
  if (meta.kind === "initial-design") {
    parts = parsed;
  } else {
    if (typeof parsed[meta.partKey] !== "string") {
      throw new Error(`Response missing expected key "${meta.partKey}".`);
    }
    parts = { ...parts, [meta.partKey]: parsed[meta.partKey] };
  }

  const svg = renderSvg(parts);
  writeFileSync(config.svgPath, svg);
  saveJson(config.partsPath, parts);
  saveJson(config.traitsPath, meta.traits);
  const readmeResult = injectIntoReadme(config.readmePath, config.svgPath, config.displayWidth);
  saveJson(config.statePath, { lastSha: meta.headSha, runIndex: meta.runIndex + 1, updatedAt: new Date().toISOString() });

  return { parts, readmeResult };
}

function main() {
  const responsePath = process.argv[2];
  if (!responsePath) {
    console.error("Usage: node scripts/dry-run-apply.mjs <path-to-response-json>");
    process.exit(1);
  }
  const config = loadConfig();
  if (!existsSync(config.metaPath)) {
    console.error(`commit-familiar (dry run): ${config.metaPath} not found -- run dry-run-prompt.mjs first.`);
    process.exit(1);
  }

  const meta = JSON.parse(readFileSync(config.metaPath, "utf8"));
  const responseText = readFileSync(responsePath, "utf8");

  const { readmeResult } = applyDryRunResponse(responseText, meta, config);
  console.log(`commit-familiar (dry run): wrote ${config.svgPath} (${meta.kind}), README: ${readmeResult}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
