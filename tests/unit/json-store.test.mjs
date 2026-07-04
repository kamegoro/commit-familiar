import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadJson, saveJson } from "../../scripts/lib/json-store.mjs";

describe("loadJson / saveJson", () => {
  let dir, filePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-json-"));
    filePath = join(dir, "state.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("loadJson returns the fallback when the file does not exist", () => {
    assert.deepEqual(loadJson(filePath, { lastSha: null }), { lastSha: null });
  });

  test("saveJson then loadJson round-trips the same data", () => {
    saveJson(filePath, { a: 1, b: [1, 2, 3] });
    assert.deepEqual(loadJson(filePath, null), { a: 1, b: [1, 2, 3] });
  });

  test("loadJson returns the fallback when the file contains invalid JSON", () => {
    writeFileSync(filePath, "{ not valid json");
    assert.deepEqual(loadJson(filePath, { safe: true }), { safe: true });
  });

  test("saveJson writes pretty-printed JSON", () => {
    saveJson(filePath, { a: 1 });
    assert.match(readFileSync(filePath, "utf8"), /\n/);
  });
});
