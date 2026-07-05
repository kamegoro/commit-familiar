// Integration tests for the dry-run dev tool (scripts/dry-run-prompt.mjs
// + scripts/dry-run-apply.mjs), which lets a Claude Code session verify
// the full pipeline without ANTHROPIC_API_KEY or any real network call.
// These tests use a real temporary git repo (same reasoning as
// digest.test.mjs: git's output format isn't ours to mock) and never
// touch the network at all, since this tool's whole point is to not need
// it.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDryRunPrompt } from "../../scripts/dry-run-prompt.mjs";
import { applyDryRunResponse, loadConfig as loadApplyConfig } from "../../scripts/dry-run-apply.mjs";
import { README_MARKER_START, README_MARKER_END } from "../../scripts/lib/svg.mjs";

function initRepo(dir) {
  execSync("git init -q -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
}

function commit(dir, filename, content, message) {
  writeFileSync(join(dir, filename), content);
  execSync(`git add ${filename}`, { cwd: dir });
  execSync(`git commit -q -m "${message}"`, { cwd: dir });
}

function withCwd(dir, fn) {
  const original = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(original);
  }
}

function promptConfig(dir, overrides = {}) {
  return {
    partsPath: join(dir, ".familiar-parts.json"),
    traitsPath: join(dir, ".familiar-traits.json"),
    statePath: join(dir, ".familiar-state.json"),
    metaPath: join(dir, ".familiar-dryrun-meta.json"),
    minCommits: 1,
    ...overrides,
  };
}

function applyConfig(dir) {
  return {
    svgPath: join(dir, "familiar.svg"),
    partsPath: join(dir, ".familiar-parts.json"),
    traitsPath: join(dir, ".familiar-traits.json"),
    statePath: join(dir, ".familiar-state.json"),
    readmePath: join(dir, "README.md"),
    metaPath: join(dir, ".familiar-dryrun-meta.json"),
  };
}

describe("buildDryRunPrompt", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-"));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns no-new-commits when the checkpoint is already at HEAD", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const headSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: headSha, runIndex: 0 }));

    const result = withCwd(dir, () => buildDryRunPrompt(promptConfig(dir)));
    assert.equal(result.action, "no-new-commits");
  });

  test("returns below-min-commits without writing a meta file", () => {
    commit(dir, "a.txt", "1", "chore: initial");

    const result = withCwd(dir, () => buildDryRunPrompt(promptConfig(dir, { minCommits: 5 })));
    assert.equal(result.action, "below-min-commits");
    assert.ok(!existsSync(join(dir, ".familiar-dryrun-meta.json")));
  });

  test("builds the initial-design prompt and writes matching metadata", () => {
    commit(dir, "a.txt", "1", "chore: initial");

    const result = withCwd(dir, () => buildDryRunPrompt(promptConfig(dir)));
    assert.equal(result.action, "initial-design");
    assert.match(result.prompt, /Design an original monster/);

    const meta = JSON.parse(readFileSync(join(dir, ".familiar-dryrun-meta.json"), "utf8"));
    assert.equal(meta.kind, "initial-design");
    assert.equal(meta.runIndex, 0);
  });

  test("builds an update-part prompt and writes matching metadata when parts already exist", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const allParts = { "body-slot": "<rect/>", "eyes-slot": "", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" };
    writeFileSync(join(dir, ".familiar-parts.json"), JSON.stringify(allParts));
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: firstSha, runIndex: 0 }));
    commit(dir, "b.txt", "2", "fix: something");

    const result = withCwd(dir, () => buildDryRunPrompt(promptConfig(dir)));
    assert.equal(result.action, "update-part");
    assert.ok(["body-slot", "eyes-slot", "mouth-slot", "hat-slot", "armor-slot", "shoes-slot"].includes(result.partKey));

    const meta = JSON.parse(readFileSync(join(dir, ".familiar-dryrun-meta.json"), "utf8"));
    assert.equal(meta.kind, "update-part");
    assert.equal(meta.partKey, result.partKey);
  });
});

describe("applyDryRunResponse", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryapply-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes familiar.svg and parts.json for an initial-design response", () => {
    const allParts = { "body-slot": "<rect/>", "eyes-slot": "", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" };
    const meta = { kind: "initial-design", traits: { totalCommits: 1 }, headSha: "abc123", runIndex: 0 };

    const { parts } = applyDryRunResponse(JSON.stringify(allParts), meta, applyConfig(dir));
    assert.deepEqual(parts, allParts);
    assert.ok(existsSync(join(dir, "familiar.svg")));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, ".familiar-traits.json"), "utf8")), { totalCommits: 1 });
  });

  test("merges a single-part update response into existing parts", () => {
    const existing = { "body-slot": "<rect/>", "eyes-slot": "<old/>", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" };
    writeFileSync(join(dir, ".familiar-parts.json"), JSON.stringify(existing));
    const meta = { kind: "update-part", partKey: "eyes-slot", traits: {}, headSha: "abc123", runIndex: 3 };

    const { parts } = applyDryRunResponse('{"eyes-slot": "<new/>"}', meta, applyConfig(dir));
    assert.equal(parts["eyes-slot"], "<new/>");
    assert.equal(parts["body-slot"], existing["body-slot"]);
  });

  test("throws when an update response is missing the expected part key", () => {
    writeFileSync(join(dir, ".familiar-parts.json"), JSON.stringify({ "eyes-slot": "" }));
    const meta = { kind: "update-part", partKey: "eyes-slot", traits: {}, headSha: "abc", runIndex: 0 };

    assert.throws(() => applyDryRunResponse('{"wrong-key": "<x/>"}', meta, applyConfig(dir)), /Response missing expected key/);
  });

  test("advances runIndex and writes lastSha from the metadata", () => {
    const meta = { kind: "initial-design", traits: {}, headSha: "deadbeef", runIndex: 2 };
    applyDryRunResponse('{"body-slot": "<rect/>"}', meta, applyConfig(dir));

    const state = JSON.parse(readFileSync(join(dir, ".familiar-state.json"), "utf8"));
    assert.equal(state.lastSha, "deadbeef");
    assert.equal(state.runIndex, 3);
  });

  test("embeds the character into the README when markers are present", () => {
    writeFileSync(join(dir, "README.md"), `# Title\n${README_MARKER_START}\n${README_MARKER_END}\n`);
    const meta = { kind: "initial-design", traits: {}, headSha: "abc", runIndex: 0 };

    const { readmeResult } = applyDryRunResponse('{"body-slot": "<rect/>"}', meta, applyConfig(dir));
    assert.equal(readmeResult, "updated");
    assert.match(readFileSync(join(dir, "README.md"), "utf8"), /!\[familiar\]/);
  });
});

describe("dry-run scripts as a CLI pair", () => {
  const SCRIPT_DIR = join(import.meta.dirname, "..", "..", "scripts");

  test("prints the no-new-commits message when the checkpoint is already current", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-cli-"));
    try {
      initRepo(dir);
      commit(dir, "a.txt", "1", "chore: initial");
      const headSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
      writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: headSha, runIndex: 0 }));

      const output = execSync(`node ${join(SCRIPT_DIR, "dry-run-prompt.mjs")}`, { cwd: dir }).toString();
      assert.match(output, /no new commits since last run/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints the below-min-commits message when FAMILIAR_MIN_COMMITS isn't met", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-cli-"));
    try {
      initRepo(dir);
      commit(dir, "a.txt", "1", "chore: initial");

      const output = execSync(`node ${join(SCRIPT_DIR, "dry-run-prompt.mjs")}`, {
        cwd: dir,
        env: { ...process.env, FAMILIAR_MIN_COMMITS: "5" },
      }).toString();
      assert.match(output, /below FAMILIAR_MIN_COMMITS=5/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prints an update-part prompt when parts already exist, via actual subprocesses", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-cli-"));
    try {
      initRepo(dir);
      commit(dir, "a.txt", "1", "chore: initial");
      const allParts = { "body-slot": "<rect/>", "eyes-slot": "", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" };
      writeFileSync(join(dir, ".familiar-parts.json"), JSON.stringify(allParts));
      const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
      writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: firstSha, runIndex: 0 }));
      commit(dir, "b.txt", "2", "fix: something");

      const output = execSync(`node ${join(SCRIPT_DIR, "dry-run-prompt.mjs")}`, { cwd: dir }).toString();
      assert.match(output, /UPDATE PROMPT for/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prompt then apply produces a real familiar.svg via actual subprocesses", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-cli-"));
    try {
      initRepo(dir);
      commit(dir, "a.txt", "1", "chore: initial");

      const promptOutput = execSync(`node ${join(SCRIPT_DIR, "dry-run-prompt.mjs")}`, { cwd: dir }).toString();
      assert.match(promptOutput, /INITIAL DESIGN PROMPT/);
      assert.ok(existsSync(join(dir, ".familiar-dryrun-meta.json")));

      const responsePath = join(dir, "response.json");
      writeFileSync(responsePath, JSON.stringify({ "body-slot": "<rect/>", "eyes-slot": "", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" }));

      const applyOutput = execSync(`node ${join(SCRIPT_DIR, "dry-run-apply.mjs")} ${responsePath}`, { cwd: dir }).toString();
      assert.match(applyOutput, /wrote familiar\.svg/);
      assert.ok(existsSync(join(dir, "familiar.svg")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dry-run-apply.mjs exits with an error when run before dry-run-prompt.mjs", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-cli-"));
    try {
      writeFileSync(join(dir, "response.json"), "{}");
      assert.throws(() => execSync(`node ${join(SCRIPT_DIR, "dry-run-apply.mjs")} ${join(dir, "response.json")}`, { cwd: dir }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dry-run-apply.mjs exits with an error when no response path is given", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-dryrun-cli-"));
    try {
      assert.throws(() => execSync(`node ${join(SCRIPT_DIR, "dry-run-apply.mjs")}`, { cwd: dir }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
