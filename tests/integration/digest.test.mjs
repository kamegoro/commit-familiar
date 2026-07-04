// Integration tests against a real temporary git repository, rather than
// mocking git's behavior -- git's own CLI output format is not something
// this project owns or should assert about via stubs; a real repo is the
// only trustworthy fixture for it.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildActivityDigest,
  digestToFacts,
  extractKeywordHits,
  parseExtensionCountLine,
  MAX_MESSAGES_IN_DIGEST,
} from "../../scripts/lib/digest.mjs";

function initRepo(dir) {
  execSync("git init -q -b main", { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
}

function commit(dir, filename, content, message, dateOffsetHours = 0) {
  writeFileSync(join(dir, filename), content);
  execSync(`git add ${filename}`, { cwd: dir });
  const date = new Date(Date.now() + dateOffsetHours * 3600 * 1000).toISOString();
  execSync(`git commit -q -m "${message}" --date="${date}"`, {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
}

describe("parseExtensionCountLine", () => {
  test("parses a real 'uniq -c' style line into {ext, count}", () => {
    assert.deepEqual(parseExtensionCountLine("   3 lua"), { ext: "lua", count: 3 });
  });

  test("returns null for a line that doesn't match the expected shape", () => {
    assert.equal(parseExtensionCountLine("not a count line"), null);
  });

  test("returns null for an empty string", () => {
    assert.equal(parseExtensionCountLine(""), null);
  });
});

describe("extractKeywordHits", () => {
  test("finds known technology keywords in commit messages, case-insensitively", () => {
    assert.deepEqual(extractKeywordHits(["Add Rust support", "fix RUST bug"]), { rust: 2 });
  });

  test("does not match a keyword as a substring of another word", () => {
    // "diagonal" contains the letters "go" but with no word boundary on
    // either side, so it must not register as a "go" mention. (An
    // earlier version of this test used "goutline.go" instead, which
    // turned out to be a bad example, not a bug: the trailing ".go" file
    // extension is itself a real standalone "go" token once the period
    // creates a word boundary, so \bgo\b correctly does match there.)
    assert.deepEqual(extractKeywordHits(["fix diagonal layout bug"]), {});
  });

  test("returns an empty object when nothing matches", () => {
    assert.deepEqual(extractKeywordHits(["chore: bump version"]), {});
  });
});

describe("buildActivityDigest", () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-digest-"));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when there are no commits in range", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const headSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    assert.equal(buildActivityDigest(headSha, dir), null);
  });

  test("counts commits and collects messages since a given SHA", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    commit(dir, "b.rs", "2", "feat: add rust file");
    commit(dir, "c.rs", "3", "fix: bug in rust file");

    const digest = buildActivityDigest(firstSha, dir);
    assert.equal(digest.commitCount, 2);
    assert.deepEqual(digest.messages, ["fix: bug in rust file", "feat: add rust file"]);
  });

  test("digests the whole history from the root commit when sinceSha is null", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    commit(dir, "b.txt", "2", "feat: second file");

    const digest = buildActivityDigest(null, dir);
    assert.equal(digest.commitCount, 2);
  });

  test("excludes merge commits from the count and message list", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();

    execSync("git checkout -q -b feature", { cwd: dir });
    commit(dir, "feature.txt", "x", "feat: feature work");
    execSync("git checkout -q main", { cwd: dir });
    commit(dir, "main.txt", "y", "chore: unrelated main work");
    execSync('git merge --no-ff -q feature -m "Merge pull request #1 from feature"', { cwd: dir });

    const digest = buildActivityDigest(firstSha, dir);
    assert.equal(digest.commitCount, 2); // feature work + main work, not the merge commit itself
    assert.ok(!digest.messages.some((m) => m.startsWith("Merge pull request")));
  });

  test("reports file extensions touched, with counts", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    commit(dir, "one.lua", "x", "feat: lua file");
    commit(dir, "two.lua", "y", "feat: another lua file");

    const digest = buildActivityDigest(firstSha, dir);
    const luaEntry = digest.extensions.find((e) => e.ext === "lua");
    assert.ok(luaEntry);
    assert.equal(luaEntry.count, 2);
  });

  test("computes nightRatio from commit hours (22:00-05:00 counted as night)", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    execSync('git commit --allow-empty -q -m "night commit" --date="2026-01-01T23:00:00"', {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T23:00:00", GIT_COMMITTER_DATE: "2026-01-01T23:00:00" },
    });
    execSync('git commit --allow-empty -q -m "day commit" --date="2026-01-01T12:00:00"', {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T12:00:00", GIT_COMMITTER_DATE: "2026-01-01T12:00:00" },
    });

    const digest = buildActivityDigest(firstSha, dir);
    assert.equal(digest.nightRatio, 0.5);
  });

  test("counts distinct calendar days across commits", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    for (const date of ["2026-01-01T10:00:00", "2026-01-01T14:00:00", "2026-01-02T10:00:00"]) {
      execSync(`git commit --allow-empty -q -m "commit on ${date}"`, {
        cwd: dir,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
    }
    const digest = buildActivityDigest(firstSha, dir);
    assert.equal(digest.commitCount, 3);
    assert.equal(digest.distinctDays, 2);
  });

  test("extracts keyword hits from the collected commit messages", () => {
    commit(dir, "a.txt", "1", "chore: initial");
    const firstSha = execSync("git rev-parse HEAD", { cwd: dir }).toString().trim();
    commit(dir, "b.py", "x", "feat: add python support");

    const digest = buildActivityDigest(firstSha, dir);
    assert.deepEqual(digest.keywordHits, { python: 1 });
  });
});

describe("digestToFacts", () => {
  const baseDigest = { commitCount: 1, filesChanged: 1, extensions: [], keywordHits: {}, nightRatio: 0 };

  test("shows 'none' / 'none detected' when there is no extension or keyword signal", () => {
    const facts = digestToFacts({ ...baseDigest, messages: ["chore: x"] });
    assert.match(facts, /Top file types touched: none\./);
    assert.match(facts, /Technologies mentioned in commit messages: none detected\./);
  });

  test("caps the commit message list and notes how many were omitted", () => {
    const messages = Array.from({ length: MAX_MESSAGES_IN_DIGEST + 5 }, (_, i) => `fix: bug ${i}`);
    const facts = digestToFacts({ ...baseDigest, messages });
    const shownLines = facts.split("\n").filter((l) => l.startsWith("- fix:"));
    assert.equal(shownLines.length, MAX_MESSAGES_IN_DIGEST);
    assert.match(facts, /\.\.\.and 5 more/);
  });

  test("does not add an '...and N more' note when under the cap", () => {
    const facts = digestToFacts({ ...baseDigest, messages: ["fix: only one"] });
    assert.doesNotMatch(facts, /more$/m);
  });
});
