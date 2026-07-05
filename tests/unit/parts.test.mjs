import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonObject,
  reasonForPart,
  buildInitialPrompt,
  buildUpdatePrompt,
  styleFromSeed,
  composeSilhouette,
  PART_SPECS,
  SILHOUETTE_PROPORTIONS,
  SILHOUETTE_LEANS,
  SILHOUETTE_TAPERS,
  SILHOUETTE_EDGE_QUALITIES,
  SILHOUETTE_SEGMENTATIONS,
  SILHOUETTE_APPENDAGES,
  SILHOUETTE_WEIGHT_DISTRIBUTIONS,
  DISTINCTIVE_FEATURES,
  PALETTE_MOODS,
  SURFACE_PATTERNS,
  MONSTER_FAMILIES,
} from "../../scripts/lib/parts.mjs";

const SILHOUETTE_SPACE =
  SILHOUETTE_PROPORTIONS.length *
  SILHOUETTE_LEANS.length *
  SILHOUETTE_TAPERS.length *
  SILHOUETTE_EDGE_QUALITIES.length *
  SILHOUETTE_SEGMENTATIONS.length *
  SILHOUETTE_APPENDAGES.length *
  SILHOUETTE_WEIGHT_DISTRIBUTIONS.length;

describe("composeSilhouette", () => {
  test("the silhouette axis alone reaches at least 10,000 distinguishable combinations (the bar the user set)", () => {
    assert.ok(SILHOUETTE_SPACE >= 10000, `silhouette space is only ${SILHOUETTE_SPACE}`);
  });

  test("every sub-axis phrase appears in the composed description", () => {
    const { description } = composeSilhouette(12345);
    for (const list of [
      SILHOUETTE_PROPORTIONS,
      SILHOUETTE_LEANS,
      SILHOUETTE_TAPERS,
      SILHOUETTE_EDGE_QUALITIES,
      SILHOUETTE_SEGMENTATIONS,
      SILHOUETTE_APPENDAGES,
      SILHOUETTE_WEIGHT_DISTRIBUTIONS,
    ]) {
      assert.ok(list.some((phrase) => description.includes(phrase)), `no phrase from [${list[0]}...] found in "${description}"`);
    }
  });

  test("is deterministic for the same seed", () => {
    assert.deepEqual(composeSilhouette(999), composeSilhouette(999));
  });

  test("two different seeds within the silhouette space produce different descriptions", () => {
    const a = composeSilhouette(0);
    const b = composeSilhouette(1);
    assert.notEqual(a.description, b.description);
  });

  test("returns the leftover remainder so callers can keep splitting further axes", () => {
    const { remainder } = composeSilhouette(SILHOUETTE_SPACE * 3 + 7);
    assert.equal(remainder, 3);
  });
});

describe("styleFromSeed", () => {
  test("hue is always within 0-359", () => {
    for (const seed of [0, 1, 359, 360, 999999, 4294967295]) {
      const { hue } = styleFromSeed(seed);
      assert.ok(hue >= 0 && hue < 360, `hue ${hue} out of range for seed ${seed}`);
    }
  });

  test("every axis is always one of the global known descriptions", () => {
    for (const seed of [0, 1, 12345, 4294967295]) {
      const { feature, paletteMood, surfacePattern } = styleFromSeed(seed);
      assert.ok(DISTINCTIVE_FEATURES.includes(feature));
      assert.ok(PALETTE_MOODS.includes(paletteMood));
      assert.ok(SURFACE_PATTERNS.includes(surfacePattern));
    }
  });

  test("every axis stays within that specific family's own allowed subset, not just the global list", () => {
    // The whole point of the family system is coherence: a "gelatinous"
    // creature should never get a feature/mood/pattern that only some
    // *other* family was designed to use.
    for (let seed = 0; seed < MONSTER_FAMILIES.length * 50; seed++) {
      const family = MONSTER_FAMILIES[seed % MONSTER_FAMILIES.length];
      const { familyName, hue, feature, paletteMood, surfacePattern } = styleFromSeed(seed);
      assert.equal(familyName, family.name);

      const hueInBand = Array.from({ length: family.hueSpan }, (_, i) => (family.hueStart + i) % 360).includes(hue);
      assert.ok(hueInBand, `hue ${hue} outside ${family.name}'s band [${family.hueStart}, +${family.hueSpan})`);

      assert.ok(family.featureIndices.map((i) => DISTINCTIVE_FEATURES[i]).includes(feature));
      assert.ok(family.paletteMoodIndices.map((i) => PALETTE_MOODS[i]).includes(paletteMood));
      assert.ok(family.surfacePatternIndices.map((i) => SURFACE_PATTERNS[i]).includes(surfacePattern));
    }
  });

  test("the silhouette field is a non-empty composed description, independent of family", () => {
    const { silhouette } = styleFromSeed(42);
    assert.ok(typeof silhouette === "string" && silhouette.length > 0);
  });

  test("even the smallest family's combinatorial space comfortably clears 10,000", () => {
    for (const family of MONSTER_FAMILIES) {
      const perFamily = family.hueSpan * family.paletteMoodIndices.length * family.surfacePatternIndices.length * family.featureIndices.length * SILHOUETTE_SPACE;
      assert.ok(perFamily >= 10000, `${family.name}'s space is only ${perFamily}`);
    }
    const total = MONSTER_FAMILIES.reduce(
      (sum, f) => sum + f.hueSpan * f.paletteMoodIndices.length * f.surfacePatternIndices.length * f.featureIndices.length * SILHOUETTE_SPACE,
      0
    );
    assert.ok(total < 2 ** 32, "combined combinatorial space exceeds a 32-bit hash's entropy");
  });

  test("is deterministic for the same seed", () => {
    assert.deepEqual(styleFromSeed(42), styleFromSeed(42));
  });

  test("different seeds produce different combinations across a sample", () => {
    const results = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => JSON.stringify(styleFromSeed(s * 137))));
    // Not asserting all 10 are unique (the space could coincidentally repeat),
    // but a real fix should produce meaningfully more than one distinct result.
    assert.ok(results.size > 1, "expected more than one distinct style across varied seeds");
  });
});

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
  const digest = { commitCount: 3, filesChanged: 2, extensions: [], keywordHits: {}, messages: ["feat: x"], nightRatio: 0, rootSha: "abc123" };

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

  test("embeds a concrete hue degree, composed silhouette, feature, palette mood, and surface pattern", () => {
    const prompt = buildInitialPrompt(digest);
    assert.match(prompt, /hue \d+° on the color wheel/);
    const alt = (list) => new RegExp(list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"));
    assert.match(prompt, alt(SILHOUETTE_PROPORTIONS));
    assert.match(prompt, alt(DISTINCTIVE_FEATURES));
    assert.match(prompt, alt(PALETTE_MOODS));
    assert.match(prompt, alt(SURFACE_PATTERNS));
  });

  test("two repositories with different root commits get visibly different style instructions", () => {
    const promptA = buildInitialPrompt({ ...digest, rootSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    const promptB = buildInitialPrompt({ ...digest, rootSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    assert.notEqual(promptA, promptB);
  });

  test("is deterministic: the same repository always gets the same style instruction", () => {
    const promptA = buildInitialPrompt(digest);
    const promptB = buildInitialPrompt(digest);
    assert.equal(promptA, promptB);
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
