import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonObject,
  reasonForPart,
  buildInitialPrompt,
  buildUpdatePrompt,
  PART_SPECS,
} from "../../scripts/lib/parts.mjs";

describe("extractJsonObject", () => {
  test("parses a plain JSON object with no fences", () => {
    assert.deepEqual(extractJsonObject('{"eyes-slot": "<rect/>"}'), { "eyes-slot": "<rect/>" });
  });

  test("strips a ```json fenced block", () => {
    const text = 'Sure!\n```json\n{"eyes-slot": "<rect/>"}\n```\nHope that helps.';
    assert.deepEqual(extractJsonObject(text), { "eyes-slot": "<rect/>" });
  });

  test("strips a fenced block with no language tag", () => {
    const text = '```\n{"eyes-slot": "<rect/>"}\n```';
    assert.deepEqual(extractJsonObject(text), { "eyes-slot": "<rect/>" });
  });

  test("throws when the response contains no JSON object", () => {
    assert.throws(() => extractJsonObject("sorry, I cannot help with that"), /did not contain a parseable JSON/);
  });
});

describe("reasonForPart", () => {
  const digest = {};

  test("explains hat-slot as a dominant technology shift", () => {
    assert.match(reasonForPart("hat-slot", {}, digest), /dominant technology/);
  });

  test("explains armor-slot with the current total commit count", () => {
    assert.match(reasonForPart("armor-slot", { totalCommits: 50 }, digest), /50/);
  });

  test("explains shoes-slot with the formatted consistency score", () => {
    const reason = reasonForPart("shoes-slot", { consistencyScore: 0.756 }, digest);
    assert.match(reason, /0\.76/);
  });

  test("falls back to a routine mood refresh for eyes/mouth", () => {
    assert.match(reasonForPart("eyes-slot", {}, digest), /routine periodic mood refresh/);
  });
});

describe("buildInitialPrompt", () => {
  const digest = { commitCount: 3, filesChanged: 2, extensions: [], keywordHits: {}, messages: ["feat: x"], nightRatio: 0 };

  test("includes every part slot key", () => {
    const prompt = buildInitialPrompt(digest);
    for (const key of Object.keys(PART_SPECS)) {
      assert.match(prompt, new RegExp(`"${key}"`));
    }
  });

  test("instructs raw SVG markup with no wrapper or id/class attributes", () => {
    const prompt = buildInitialPrompt(digest);
    assert.match(prompt, /no <svg> wrapper, no id or class/);
  });

  test("does not name any specific game, console, or franchise", () => {
    const prompt = buildInitialPrompt(digest);
    assert.doesNotMatch(prompt, /pok[eé]mon|tamagotchi|game ?boy|nintendo/i);
  });

  test("embeds the digest's activity facts", () => {
    const prompt = buildInitialPrompt(digest);
    assert.match(prompt, /3 commits since last update/);
  });
});

describe("buildUpdatePrompt", () => {
  const digest = { commitCount: 1, filesChanged: 1, extensions: [], keywordHits: {}, messages: ["fix: y"], nightRatio: 0 };
  const traits = { totalCommits: 10, nightOwlRatio: 0.5, consistencyScore: 0.4 };

  test("names the specific part being updated", () => {
    const prompt = buildUpdatePrompt("hat-slot", "<rect/>", traits, digest);
    assert.match(prompt, /"hat-slot"/);
  });

  test("shows the current content verbatim when non-empty", () => {
    const prompt = buildUpdatePrompt("hat-slot", '<rect fill="red"/>', traits, digest);
    assert.match(prompt, /<rect fill="red"\/>/);
  });

  test("shows (empty) when the slot has no prior content", () => {
    const prompt = buildUpdatePrompt("hat-slot", "", traits, digest);
    assert.match(prompt, /\(empty\)/);
  });

  test("does not name any specific game, console, or franchise", () => {
    const prompt = buildUpdatePrompt("hat-slot", "", traits, digest);
    assert.doesNotMatch(prompt, /pok[eé]mon|tamagotchi|game ?boy|nintendo/i);
  });
});
