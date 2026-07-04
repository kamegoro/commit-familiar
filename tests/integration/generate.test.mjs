// Integration tests for the orchestrator: a real temporary git repo
// drives buildActivityDigest, and the only network call (Claude) is
// stubbed at the global fetch level so these tests never require a live
// ANTHROPIC_API_KEY or spend real API credit.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, main, loadConfig } from "../../scripts/generate.mjs";
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

function baseConfig(dir, overrides = {}) {
  return {
    apiKey: "fake-key",
    svgPath: join(dir, "familiar.svg"),
    partsPath: join(dir, ".familiar-parts.json"),
    traitsPath: join(dir, ".familiar-traits.json"),
    statePath: join(dir, ".familiar-state.json"),
    readmePath: join(dir, "README.md"),
    minCommits: 1,
    updateModel: "claude-haiku-test",
    initModel: "claude-sonnet-test",
    ...overrides,
  };
}

// run() shells out to `git rev-parse HEAD` (and buildActivityDigest shells
// out too) using the process's own cwd, not a `cwd` config option -- so
// these tests chdir into the fixture repo, same as the real GitHub Action
// always runs from inside the checked-out repo.
function withCwd(dir, fn) {
  const original = process.cwd();
  process.chdir(dir);
  return Promise.resolve()
    .then(fn)
    .finally(() => process.chdir(original));
}

describe("run", () => {
  let dir, restoreFetch;
  const allParts = { "body-slot": "<rect/>", "eyes-slot": "", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-run-"));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (restoreFetch) restoreFetch();
  });

  function stubFetch(responseText) {
    const original = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: responseText }] }) });
    restoreFetch = () => {
      global.fetch = original;
    };
  }

  test("throws when apiKey is missing", async () => {
    commit(dir, "a.txt", "1", "chore: initial");
    await withCwd(dir, () => assert.rejects(() => run(baseConfig(dir, { apiKey: undefined })), /ANTHROPIC_API_KEY is not set/));
  });

  test("returns no-new-commits when the checkpoint is already at HEAD", async () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const headSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: headSha, runIndex: 0 }));

    const result = await withCwd(dir, () => run(baseConfig(dir)));
    assert.equal(result.action, "no-new-commits");
  });

  test("returns below-min-commits and does not advance the checkpoint", async () => {
    commit(dir, "a.txt", "1", "chore: initial");

    const result = await withCwd(dir, () => run(baseConfig(dir, { minCommits: 5 })));
    assert.equal(result.action, "below-min-commits");
    assert.equal(result.commitCount, 1);
    assert.ok(!existsSync(join(dir, ".familiar-state.json")), "state file should not be written when skipped");
  });

  test("designs the initial character on the first real run", async () => {
    commit(dir, "a.txt", "1", "chore: initial");
    stubFetch(JSON.stringify(allParts));

    const result = await withCwd(dir, () => run(baseConfig(dir)));
    assert.equal(result.action, "initial-design");
    assert.ok(existsSync(join(dir, "familiar.svg")));
    const savedParts = JSON.parse(readFileSync(join(dir, ".familiar-parts.json"), "utf8"));
    assert.deepEqual(savedParts, allParts);
  });

  test("updates exactly one part and preserves the rest on a later run", async () => {
    commit(dir, "a.txt", "1", "chore: initial");
    writeFileSync(join(dir, ".familiar-parts.json"), JSON.stringify(allParts));
    writeFileSync(join(dir, ".familiar-traits.json"), JSON.stringify({}));
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: firstSha, runIndex: 0 }));
    commit(dir, "b.txt", "2", "fix: something");

    stubFetch('{"eyes-slot": "<rect id=\\"new-eye\\"/>"}');
    const result = await withCwd(dir, () => run(baseConfig(dir)));

    assert.equal(result.action, "updated-part");
    assert.equal(result.updatedPart, "eyes-slot");
    const savedParts = JSON.parse(readFileSync(join(dir, ".familiar-parts.json"), "utf8"));
    assert.match(savedParts["eyes-slot"], /new-eye/);
    assert.equal(savedParts["body-slot"], allParts["body-slot"]); // untouched parts survive as-is
  });

  test("advances the checkpoint's runIndex and lastSha after a successful run", async () => {
    commit(dir, "a.txt", "1", "chore: initial");
    stubFetch(JSON.stringify(allParts));
    await withCwd(dir, () => run(baseConfig(dir)));

    const state = JSON.parse(readFileSync(join(dir, ".familiar-state.json"), "utf8"));
    assert.equal(state.runIndex, 1);
    assert.equal(state.lastSha, execSync("git rev-parse HEAD", { cwd: dir }).toString().trim());
  });

  test("embeds the character into the README when markers are present", async () => {
    commit(dir, "a.txt", "1", "chore: initial");
    writeFileSync(join(dir, "README.md"), `# Title\n${README_MARKER_START}\n${README_MARKER_END}\n`);
    stubFetch(JSON.stringify(allParts));

    const result = await withCwd(dir, () => run(baseConfig(dir)));
    assert.equal(result.readmeResult, "updated");
    assert.match(readFileSync(join(dir, "README.md"), "utf8"), /!\[familiar\]/);
  });
});

describe("loadConfig", () => {
  test("falls back to sensible defaults when no env vars are set", () => {
    const config = loadConfig({});
    assert.equal(config.svgPath, "familiar.svg");
    assert.equal(config.minCommits, 1);
    assert.equal(config.updateModel, "claude-haiku-4-5-20251001");
  });

  test("reads every value from the provided env object", () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: "k",
      FAMILIAR_SVG_PATH: "x.svg",
      FAMILIAR_PARTS_PATH: "p.json",
      FAMILIAR_TRAITS_PATH: "t.json",
      FAMILIAR_STATE_PATH: "s.json",
      FAMILIAR_README_PATH: "R.md",
      FAMILIAR_MIN_COMMITS: "7",
      FAMILIAR_UPDATE_MODEL: "u-model",
      FAMILIAR_INIT_MODEL: "i-model",
    });
    assert.deepEqual(config, {
      apiKey: "k",
      svgPath: "x.svg",
      partsPath: "p.json",
      traitsPath: "t.json",
      statePath: "s.json",
      readmePath: "R.md",
      minCommits: 7,
      updateModel: "u-model",
      initModel: "i-model",
    });
  });
});

describe("main", () => {
  test("returns 0 and logs the no-new-commits message", async () => {
    const code = await main(async () => ({ action: "no-new-commits" }), {});
    assert.equal(code, 0);
  });

  test("returns 0 and logs the below-min-commits message", async () => {
    const code = await main(async () => ({ action: "below-min-commits", commitCount: 2 }), { minCommits: 5 });
    assert.equal(code, 0);
  });

  test("returns 0 and logs the initial-design message", async () => {
    const code = await main(async () => ({ action: "initial-design" }), { svgPath: "familiar.svg" });
    assert.equal(code, 0);
  });

  test("returns 0 and logs the updated-part message", async () => {
    const code = await main(async () => ({ action: "updated-part", updatedPart: "hat-slot" }), { svgPath: "familiar.svg" });
    assert.equal(code, 0);
  });

  test("returns 1 when runFn throws", async () => {
    const code = await main(async () => {
      throw new Error("boom");
    }, {});
    assert.equal(code, 1);
  });
});
