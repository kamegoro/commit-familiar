// Pure logic, no I/O of any kind -- growth tracking and the "which part
// updates this run" decision. Kept separate from digest.mjs (which
// touches git) and svg.mjs (which touches the filesystem) specifically so
// this module can be unit tested with plain objects and no fixtures.

export const ARMOR_MILESTONE_STEP = 25;

export function topEntry(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// Cumulative, multi-dimensional, uncapped by design: each field keeps
// drifting forever, there is no "max level" state. See .agent/plan.md for
// why this replaced an earlier single-level-number design.
export function updateTraits(traits, digest) {
  const previousTotal = traits.totalCommits || 0;
  const newTotal = previousTotal + digest.commitCount;
  // Combine extension counts and keyword mentions into one "identity"
  // signal so either source can drive it.
  const previousDominant = topEntry({ ...(traits.extCounts || {}), ...(traits.keywordCounts || {}) });

  const t = {
    totalCommits: newTotal,
    nightOwlRatio: traits.nightOwlRatio == null ? digest.nightRatio : traits.nightOwlRatio * 0.7 + digest.nightRatio * 0.3,
    // Ratio of distinct active days to commits, this run: closer to 1
    // means work was spread out; closer to 0 means one big burst.
    consistencyScore:
      traits.consistencyScore == null
        ? digest.distinctDays / Math.max(digest.commitCount, 1)
        : traits.consistencyScore * 0.7 + (digest.distinctDays / Math.max(digest.commitCount, 1)) * 0.3,
    extCounts: { ...(traits.extCounts || {}) },
    keywordCounts: { ...(traits.keywordCounts || {}) },
    armorMilestoneCrossed: false,
    dominantIdentityChanged: false,
  };
  for (const { ext, count } of digest.extensions) t.extCounts[ext] = (t.extCounts[ext] || 0) + count;
  for (const [kw, count] of Object.entries(digest.keywordHits)) t.keywordCounts[kw] = (t.keywordCounts[kw] || 0) + count;

  const newDominant = topEntry({ ...t.extCounts, ...t.keywordCounts });
  t.dominantIdentityChanged = previousDominant !== null && newDominant !== previousDominant;

  // Crossed a multiple of ARMOR_MILESTONE_STEP during this run.
  t.armorMilestoneCrossed = Math.floor(previousTotal / ARMOR_MILESTONE_STEP) !== Math.floor(newTotal / ARMOR_MILESTONE_STEP);

  return t;
}

// Deterministic, in code: Claude is never asked "which part should
// change", only "here is the one part you're updating". Keeps the model
// call narrow and keeps this decision inspectable/debuggable as plain
// logic rather than an LLM judgment call. Priority order reflects which
// signal is rarest/most notable; routine mood (eyes/mouth) is the
// fallback for an ordinary week.
export function pickPartToUpdate(traits, digest, runIndex) {
  if (traits.armorMilestoneCrossed) return "armor-slot"; // commit-count milestone
  if (traits.dominantIdentityChanged) return "hat-slot"; // tech identity shifted
  if (traits.consistencyScore >= 0.6 && digest.commitCount >= 3) return "shoes-slot"; // steady, spread-out work
  return runIndex % 2 === 0 ? "eyes-slot" : "mouth-slot";
}
