#!/usr/bin/env node
// commit-familiar orchestrator. Wires together the modules in lib/ --
// see .agent/plan.md for the full design rationale (why SVG instead of a
// diffusion backend, why a fixed rig + independent parts instead of one
// freely-regenerated image, why growth has no ceiling, why file contents/
// diffs are never read).
//
// Deliberately thin: every piece of actual logic lives in scripts/lib/
// and is unit/integration tested there. This file only reads env/CLI
// config, loads state, calls the lib functions in order, and writes
// results back out -- and only runs main() when executed directly (not
// when imported), so tests can import individual lib modules freely.

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { buildActivityDigest } from "./lib/digest.mjs";
import { updateTraits, pickPartToUpdate } from "./lib/traits.mjs";
import { generateInitialParts, updatePart } from "./lib/claude.mjs";
import { renderSvg, injectIntoReadme, DEFAULT_DISPLAY_WIDTH } from "./lib/svg.mjs";
import { loadJson, saveJson } from "./lib/json-store.mjs";

export function loadConfig(env = process.env) {
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    svgPath: env.FAMILIAR_SVG_PATH || "familiar.svg",
    partsPath: env.FAMILIAR_PARTS_PATH || ".familiar-parts.json",
    traitsPath: env.FAMILIAR_TRAITS_PATH || ".familiar-traits.json",
    statePath: env.FAMILIAR_STATE_PATH || ".familiar-state.json",
    readmePath: env.FAMILIAR_README_PATH || "README.md",
    // How large the character displays in the README -- distinct from
    // the SVG's own internal pixel grid/viewBox, which stays a fixed
    // 200x200 regardless. Configurable since "too big" is a matter of
    // taste per repo (user feedback, 2026-07-06).
    displayWidth: parseInt(env.FAMILIAR_DISPLAY_WIDTH || String(DEFAULT_DISPLAY_WIDTH), 10),
    // "Should this run actually do anything" threshold -- distinct from
    // run *frequency*, which is left entirely to whatever cron schedule
    // the caller sets up. Guards against updating on trivially small
    // activity even if the caller's cron fires more often than that.
    minCommits: parseInt(env.FAMILIAR_MIN_COMMITS || "1", 10),
    // A part-update call is a narrow, small task (pick/tweak one slot's
    // content) -- it does not need the top-tier model. Only the one-time
    // initial full-character design uses the stronger default below.
    updateModel: env.FAMILIAR_UPDATE_MODEL || "claude-haiku-4-5-20251001",
    initModel: env.FAMILIAR_INIT_MODEL || "claude-sonnet-5",
  };
}

export async function run(config) {
  if (!config.apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. See README for setup.");
  }

  const state = loadJson(config.statePath, { lastSha: null, runIndex: 0 });
  const digest = buildActivityDigest(state.lastSha);

  if (!digest) {
    return { action: "no-new-commits" };
  }
  if (digest.commitCount < config.minCommits) {
    // Deliberately does NOT advance state.lastSha: these commits should
    // still count toward the threshold on the next run, not be dropped.
    return { action: "below-min-commits", commitCount: digest.commitCount };
  }

  let parts = loadJson(config.partsPath, null);
  let traits = loadJson(config.traitsPath, {});
  traits = { ...traits, ...updateTraits(traits, digest) };

  const isInitialDesign = !parts;
  let updatedPart = null;
  if (isInitialDesign) {
    parts = await generateInitialParts({ apiKey: config.apiKey, model: config.initModel, digest });
  } else {
    updatedPart = pickPartToUpdate(traits, digest, state.runIndex);
    const newContent = await updatePart({
      apiKey: config.apiKey,
      model: config.updateModel,
      partKey: updatedPart,
      currentContent: parts[updatedPart],
      traits,
      digest,
    });
    parts = { ...parts, [updatedPart]: newContent };
  }

  const svg = renderSvg(parts);
  writeFileSync(config.svgPath, svg);
  saveJson(config.partsPath, parts);
  saveJson(config.traitsPath, traits);
  const readmeResult = injectIntoReadme(config.readmePath, config.svgPath, config.displayWidth);

  const headSha = execSync("git rev-parse HEAD").toString().trim();
  saveJson(config.statePath, { lastSha: headSha, runIndex: state.runIndex + 1, updatedAt: new Date().toISOString() });

  return { action: isInitialDesign ? "initial-design" : "updated-part", updatedPart, readmeResult };
}

// Returns a process exit code (0 or 1) rather than calling process.exit
// itself, and takes runFn/config as parameters rather than reaching for
// module-level state -- both purely so this is callable from a test with
// a stubbed run() and no risk of the test process itself exiting.
export async function main(runFn = run, config = loadConfig()) {
  try {
    const result = await runFn(config);
    switch (result.action) {
      case "no-new-commits":
        console.log("commit-familiar: no new commits since last run, nothing to do.");
        break;
      case "below-min-commits":
        console.log(
          `commit-familiar: only ${result.commitCount} commit(s) since last update, below FAMILIAR_MIN_COMMITS=${config.minCommits} -- waiting for more.`
        );
        break;
      case "initial-design":
        console.log(`commit-familiar: designed the initial character, wrote ${config.svgPath}.`);
        break;
      default:
        console.log(`commit-familiar: updated "${result.updatedPart}", wrote ${config.svgPath}.`);
    }
    return 0;
  } catch (err) {
    console.error("commit-familiar: failed —", err.message);
    return 1;
  }
}

// Only auto-run when executed directly (e.g. `node generate.mjs`), not
// when imported -- lets tests import run()/main()/loadConfig() without
// triggering a real execution. This two-line guard is the one piece of
// this file intentionally left outside unit-test coverage: it has no
// branching logic of its own (module-execution-context detection is a
// language-level mechanism, not something this project decides), and
// tests/integration/cli.test.mjs exercises it for real via a subprocess
// instead.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
