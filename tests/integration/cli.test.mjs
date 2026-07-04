// Runs scripts/generate.mjs as a real subprocess, the same way the
// GitHub Action invokes it (`node .../scripts/generate.mjs`). This is the
// one part of generate.mjs not exercised by importing it directly: the
// bottom `if (import.meta.url === ...) { main().then(...) }` guard only
// runs when the file is the actual entry point, not when another module
// imports it.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT_PATH = join(import.meta.dirname, "..", "..", "scripts", "generate.mjs");

describe("generate.mjs as a CLI", () => {
  test("exits with code 1 and prints an error when ANTHROPIC_API_KEY is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-cli-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      writeFileSync(join(dir, "a.txt"), "1");
      execFileSync("git", ["add", "a.txt"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "chore: initial"], { cwd: dir });

      assert.throws(() => {
        execFileSync("node", [SCRIPT_PATH], {
          cwd: dir,
          env: { ...process.env, ANTHROPIC_API_KEY: "" },
        });
      }, /Command failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exits with code 0 and reports no new commits when the checkpoint is already current", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-familiar-cli-"));
    try {
      execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
      writeFileSync(join(dir, "a.txt"), "1");
      execFileSync("git", ["add", "a.txt"], { cwd: dir });
      execFileSync("git", ["commit", "-q", "-m", "chore: initial"], { cwd: dir });
      const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
      writeFileSync(join(dir, ".familiar-state.json"), JSON.stringify({ lastSha: headSha, runIndex: 0 }));

      const output = execFileSync("node", [SCRIPT_PATH], {
        cwd: dir,
        env: { ...process.env, ANTHROPIC_API_KEY: "fake-key-not-called" },
      }).toString();
      assert.match(output, /no new commits since last run/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
