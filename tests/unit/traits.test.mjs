import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { topEntry, updateTraits, pickPartToUpdate, ARMOR_MILESTONE_STEP } from "../../scripts/lib/traits.mjs";

describe("topEntry", () => {
  test("returns null for an empty counts object", () => {
    assert.equal(topEntry({}), null);
  });

  test("returns the key with the highest count", () => {
    assert.equal(topEntry({ a: 3, b: 9, c: 1 }), "b");
  });

  test("returns a single key unambiguously", () => {
    assert.equal(topEntry({ only: 5 }), "only");
  });
});

describe("updateTraits", () => {
  const baseDigest = { commitCount: 5, extensions: [], keywordHits: {}, nightRatio: 0, distinctDays: 5 };

  test("starts totalCommits from zero when traits is empty", () => {
    const t = updateTraits({}, baseDigest);
    assert.equal(t.totalCommits, 5);
  });

  test("accumulates totalCommits across runs", () => {
    const t = updateTraits({ totalCommits: 20 }, baseDigest);
    assert.equal(t.totalCommits, 25);
  });

  test("sets nightOwlRatio directly on the first run (no prior value)", () => {
    const t = updateTraits({}, { ...baseDigest, nightRatio: 0.8 });
    assert.equal(t.nightOwlRatio, 0.8);
  });

  test("blends nightOwlRatio as a 0.7/0.3 moving average on later runs", () => {
    const t = updateTraits({ nightOwlRatio: 0.2 }, { ...baseDigest, nightRatio: 1 });
    assert.equal(t.nightOwlRatio, 0.2 * 0.7 + 1 * 0.3);
  });

  test("sets consistencyScore directly on the first run", () => {
    const t = updateTraits({}, { ...baseDigest, distinctDays: 5, commitCount: 5 });
    assert.equal(t.consistencyScore, 1);
  });

  test("blends consistencyScore as a moving average on later runs", () => {
    const t = updateTraits({ consistencyScore: 0.5 }, { ...baseDigest, distinctDays: 1, commitCount: 5 });
    assert.equal(t.consistencyScore, 0.5 * 0.7 + 0.2 * 0.3);
  });

  test("guards against divide-by-zero when commitCount is 0", () => {
    const t = updateTraits({}, { ...baseDigest, commitCount: 0, distinctDays: 0 });
    assert.equal(t.consistencyScore, 0);
  });

  test("accumulates extCounts across runs", () => {
    const t = updateTraits(
      { extCounts: { lua: 10 } },
      { ...baseDigest, extensions: [{ ext: "lua", count: 2 }, { ext: "md", count: 1 }] }
    );
    assert.deepEqual(t.extCounts, { lua: 12, md: 1 });
  });

  test("accumulates keywordCounts across runs", () => {
    const t = updateTraits({ keywordCounts: { rust: 1 } }, { ...baseDigest, keywordHits: { rust: 2, go: 1 } });
    assert.deepEqual(t.keywordCounts, { rust: 3, go: 1 });
  });

  test("dominantIdentityChanged is false on the very first run (no prior dominant)", () => {
    const t = updateTraits({}, { ...baseDigest, extensions: [{ ext: "lua", count: 5 }] });
    assert.equal(t.dominantIdentityChanged, false);
  });

  test("dominantIdentityChanged is false when the dominant entry stays the same", () => {
    const t = updateTraits(
      { extCounts: { lua: 100 } },
      { ...baseDigest, extensions: [{ ext: "lua", count: 1 }, { ext: "md", count: 1 }] }
    );
    assert.equal(t.dominantIdentityChanged, false);
  });

  test("dominantIdentityChanged is true when a new entry overtakes the previous leader", () => {
    const t = updateTraits(
      { extCounts: { lua: 5 } },
      { ...baseDigest, extensions: [{ ext: "md", count: 20 }] }
    );
    assert.equal(t.dominantIdentityChanged, true);
  });

  test("armorMilestoneCrossed is true when total commits crosses a multiple of the step", () => {
    const t = updateTraits({ totalCommits: ARMOR_MILESTONE_STEP - 3 }, { ...baseDigest, commitCount: 5 });
    assert.equal(t.armorMilestoneCrossed, true);
  });

  test("armorMilestoneCrossed is false when the run stays within the same milestone band", () => {
    const t = updateTraits({ totalCommits: 1 }, { ...baseDigest, commitCount: 2 });
    assert.equal(t.armorMilestoneCrossed, false);
  });
});

describe("pickPartToUpdate", () => {
  const digest = { commitCount: 1 };

  test("prioritizes armor-slot when a commit-count milestone was crossed", () => {
    const traits = { armorMilestoneCrossed: true, dominantIdentityChanged: true, consistencyScore: 1 };
    assert.equal(pickPartToUpdate(traits, { commitCount: 10 }, 0), "armor-slot");
  });

  test("picks hat-slot when identity changed but no milestone was crossed", () => {
    const traits = { armorMilestoneCrossed: false, dominantIdentityChanged: true, consistencyScore: 1 };
    assert.equal(pickPartToUpdate(traits, { commitCount: 10 }, 0), "hat-slot");
  });

  test("picks shoes-slot for steady, spread-out work with at least 3 commits", () => {
    const traits = { armorMilestoneCrossed: false, dominantIdentityChanged: false, consistencyScore: 0.6 };
    assert.equal(pickPartToUpdate(traits, { commitCount: 3 }, 0), "shoes-slot");
  });

  test("does not pick shoes-slot when consistency is high but commitCount is below 3", () => {
    const traits = { armorMilestoneCrossed: false, dominantIdentityChanged: false, consistencyScore: 0.9 };
    assert.notEqual(pickPartToUpdate(traits, { commitCount: 2 }, 0), "shoes-slot");
  });

  test("alternates between eyes-slot and mouth-slot on an ordinary run, by runIndex parity", () => {
    const traits = { armorMilestoneCrossed: false, dominantIdentityChanged: false, consistencyScore: 0 };
    assert.equal(pickPartToUpdate(traits, digest, 0), "eyes-slot");
    assert.equal(pickPartToUpdate(traits, digest, 1), "mouth-slot");
    assert.equal(pickPartToUpdate(traits, digest, 2), "eyes-slot");
  });
});
