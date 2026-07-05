#!/usr/bin/env node
// Dev tool: prints the exact prompt a real run would send to Claude,
// without making any network call or requiring ANTHROPIC_API_KEY. Used
// by the verify-familiar skill (see .claude/skills/verify-familiar) so a
// Claude Code session can act as the model itself -- reasoning through
// the same prompt a real API call would receive -- to sanity-check the
// pipeline before ever spending real API credit.
//
// Reuses the exact same lib/ functions the real orchestrator
// (scripts/generate.mjs) uses, so there is no separate "test" code path
// that could drift from production behavior. Writes a small metadata
// file (not a production file) that dry-run-apply.mjs needs to finish
// the run with the same traits/digest values used to build the prompt.

import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildActivityDigest } from "./lib/digest.mjs";
import { updateTraits, pickPartToUpdate } from "./lib/traits.mjs";
import { buildInitialPrompt, buildUpdatePrompt } from "./lib/parts.mjs";
import { loadJson, saveJson } from "./lib/json-store.mjs";

export const DRYRUN_META_PATH = ".familiar-dryrun-meta.json";

export function loadConfig(env = process.env) {
  return {
    partsPath: env.FAMILIAR_PARTS_PATH || ".familiar-parts.json",
    traitsPath: env.FAMILIAR_TRAITS_PATH || ".familiar-traits.json",
    statePath: env.FAMILIAR_STATE_PATH || ".familiar-state.json",
    metaPath: env.FAMILIAR_DRYRUN_META_PATH || DRYRUN_META_PATH,
    minCommits: parseInt(env.FAMILIAR_MIN_COMMITS || "1", 10),
  };
}

// Returns a result object instead of printing directly, so this is
// directly callable/assertable from a test. Only main() below prints.
export function buildDryRunPrompt(config) {
  const state = loadJson(config.statePath, { lastSha: null, runIndex: 0 });
  const digest = buildActivityDigest(state.lastSha);

  if (!digest) return { action: "no-new-commits" };
  if (digest.commitCount < config.minCommits) {
    return { action: "below-min-commits", commitCount: digest.commitCount };
  }

  const parts = loadJson(config.partsPath, null);
  const priorTraits = loadJson(config.traitsPath, {});
  const traits = { ...priorTraits, ...updateTraits(priorTraits, digest) };
  const headSha = execSync("git rev-parse HEAD").toString().trim();

  if (!parts) {
    const meta = { kind: "initial-design", traits, headSha, runIndex: state.runIndex };
    saveJson(config.metaPath, meta);
    return { action: "initial-design", prompt: buildInitialPrompt(digest), meta };
  }

  const partKey = pickPartToUpdate(traits, digest, state.runIndex);
  const meta = { kind: "update-part", partKey, traits, headSha, runIndex: state.runIndex };
  saveJson(config.metaPath, meta);
  return { action: "update-part", partKey, prompt: buildUpdatePrompt(partKey, parts[partKey], traits, digest), meta };
}

function main() {
  const config = loadConfig();
  const result = buildDryRunPrompt(config);

  switch (result.action) {
    case "no-new-commits":
      console.log("commit-familiar (dry run): no new commits since last run, nothing to prompt for.");
      break;
    case "below-min-commits":
      console.log(
        `commit-familiar (dry run): only ${result.commitCount} commit(s) since last update, below FAMILIAR_MIN_COMMITS=${config.minCommits}.`
      );
      break;
    case "initial-design":
      console.log("=== INITIAL DESIGN PROMPT ===");
      console.log("Respond with a JSON object with all 6 keys (see prompt). No commentary, no markdown fences.");
      console.log("");
      console.log(result.prompt);
      break;
    default:
      console.log(`=== UPDATE PROMPT for "${result.partKey}" ===`);
      console.log(`Respond with a JSON object with exactly one key: {"${result.partKey}": "..."}. No commentary, no markdown fences.`);
      console.log("");
      console.log(result.prompt);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
