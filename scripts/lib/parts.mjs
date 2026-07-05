// Pure logic: part definitions, prompt construction, and response
// parsing. No I/O -- everything here is a plain function of its inputs,
// so it's unit tested directly with no fixtures or network stubs.

import { ARMOR_MILESTONE_STEP, deriveIdentitySeed } from "./traits.mjs";
import { digestToFacts } from "./digest.mjs";

// The silhouette is composed from several independent axes rather than
// picked from one flat list of hand-written descriptions -- a flat list
// can't practically reach "10,000 distinguishable silhouettes" (that
// would mean writing 10,000 unique sentences by hand), but multiplying a
// handful of independent, genuinely-orthogonal *dimensions of shape*
// together easily does: proportion x lean x taper x edge quality x
// segmentation x appendage x weight distribution = 5 x 3 x 4 x 3 x 3 x 7
// x 3 = 11,340 distinct silhouettes alone (see composeSilhouette), before
// even multiplying in hue/feature/palette/pattern on top. Each list is
// generic and no specific creature/franchise named.
export const SILHOUETTE_PROPORTIONS = [
  "wider than it is tall",
  "taller than it is wide",
  "roughly equal in width and height",
  "extremely elongated in one direction",
  "flat and wide, low to the ground",
];

export const SILHOUETTE_LEANS = ["symmetric, left and right mirrored", "asymmetric, leaning to the left", "asymmetric, leaning to the right"];

export const SILHOUETTE_TAPERS = [
  "narrowing toward the top",
  "narrowing toward the bottom",
  "bulging outward in the middle",
  "a uniform width from top to bottom",
];

export const SILHOUETTE_EDGE_QUALITIES = ["smooth and rounded", "blocky and angular", "jagged and irregular"];

export const SILHOUETTE_SEGMENTATIONS = [
  "a single unified mass with no visible seams",
  "built from 2 distinct joined segments",
  "built from 3 or more distinct joined segments",
];

export const SILHOUETTE_APPENDAGES = [
  "no limbs, just the core body",
  "small stubby legs",
  "small stubby arms",
  "a tail extending from the base",
  "wing-like nubs on the back",
  "small tentacle-like extensions",
  "a single small central nub",
];

export const SILHOUETTE_WEIGHT_DISTRIBUTIONS = ["heavier and denser toward the top", "heavier and denser toward the bottom", "evenly weighted throughout"];

// Splits `seed` across all 7 silhouette axes (mixed-radix, same technique
// as styleFromSeed) and composes them into one description. Returns both
// the composed sentence (for the prompt) and the next remainder (so the
// caller can keep splitting further axes from the same seed without
// re-deriving one from scratch).
export function composeSilhouette(seed) {
  let remainder = seed;
  const take = (list) => {
    const index = remainder % list.length;
    remainder = Math.floor(remainder / list.length);
    return list[index];
  };
  const proportion = take(SILHOUETTE_PROPORTIONS);
  const lean = take(SILHOUETTE_LEANS);
  const taper = take(SILHOUETTE_TAPERS);
  const edgeQuality = take(SILHOUETTE_EDGE_QUALITIES);
  const segmentation = take(SILHOUETTE_SEGMENTATIONS);
  const appendage = take(SILHOUETTE_APPENDAGES);
  const weightDistribution = take(SILHOUETTE_WEIGHT_DISTRIBUTIONS);

  const description =
    `${proportion}, ${lean}, ${taper}, with ${edgeQuality} edges, ${segmentation}, ` +
    `featuring ${appendage}, ${weightDistribution}`;
  return { description, remainder };
}

export const DISTINCTIVE_FEATURES = [
  "a pair of small pointed ears",
  "a single central horn",
  "a small tuft or antenna on top",
  "a short tail hinted at the base",
  "small wing-like nubs on the back",
  "a row of small spikes along the top edge",
  "one asymmetric bump or growth larger than the rest",
  "a small pattern of spots or a stripe across the body",
  "a cluster of small dots or freckles across the upper body",
  "a jagged crack-like line pattern across one side",
  "a soft glow or halo ring around the head area",
  "a small secondary limb or nub reaching out from one side",
];

export const PALETTE_MOODS = [
  "vivid and highly saturated",
  "soft and pastel, muted and gentle",
  "dark and moody, deep shadowy tones",
  "warm and earthy, like clay or autumn leaves",
  "cool and icy, pale blues and whites mixed in",
];

export const SURFACE_PATTERNS = [
  "smooth solid color bands with no additional texture",
  "a scattered pattern of small contrasting-color dots across the body",
  "diagonal stripe accents crossing part of the body",
  "a patchy, mottled two-tone texture like uneven coloring",
];

// Added 2026-07-06: eyes had no seed-derived variety at all (unlike
// silhouette/feature/palette/pattern), so every generation defaulted to
// the same "two round shaded eyes" shape regardless of repository --
// user feedback: "目のパーツが同じすぎる" (the eye parts are too similar).
export const EYE_STYLES = [
  "large round symmetric eyes, evenly spaced",
  "narrow, slightly slanted eyes",
  "one eye noticeably larger than the other",
  "eyes set close together near the center",
  "eyes set wide apart near the outer edges",
  "eyes with no visible pupils, just a solid glowing color",
  "half-lidded, sleepy-looking eyes",
  "wide, alert, slightly upturned eyes",
  "a single centered eye instead of a pair",
  "small round eyes stacked vertically instead of side by side",
];

// Researched (2026-07-05, at user request) how established
// creature-collecting games organize variety: not as fully independent
// randomized traits, but as a smaller number of cohesive *families*, each
// with a consistent texture/color/feature identity (a well-known series'
// "gelatinous" enemies are reliably soft and jelly-like across many
// different individual designs; its "crystalline"-adjacent enemies are
// reliably faceted and hard-edged) even though exact body shape varies a
// lot within a family. User preferred this over the previous fully-
// independent-axis design, which could combine into thematically
// incoherent results (an "icy" palette mood paired with "earthy" texture
// cues, for example).
//
// Each family constrains which hue band, palette moods, surface
// patterns, and features are eligible -- but not silhouette (see
// composeSilhouette), matching the observation that body *shape* varies
// freely within a family while texture/color/feature identity stays
// consistent. Indices reference PALETTE_MOODS / SURFACE_PATTERNS /
// DISTINCTIVE_FEATURES above. Names are generic, invented labels for this
// project, not taken from or referencing any existing work.
export const MONSTER_FAMILIES = [
  { name: "gelatinous", theme: "soft and translucent, with a jelly-like, gooey texture", hueStart: 100, hueSpan: 70, paletteMoodIndices: [1, 4], surfacePatternIndices: [0, 3], featureIndices: [2, 8, 10], eyeStyleIndices: [0, 5, 8] },
  { name: "crystalline", theme: "faceted and glassy, with hard reflective edges", hueStart: 250, hueSpan: 60, paletteMoodIndices: [0, 4], surfacePatternIndices: [0, 2], featureIndices: [1, 5, 9], eyeStyleIndices: [1, 5, 2] },
  { name: "verdant", theme: "leafy and organic, textured like foliage", hueStart: 70, hueSpan: 60, paletteMoodIndices: [1, 3], surfacePatternIndices: [0, 1], featureIndices: [2, 7, 11], eyeStyleIndices: [0, 6, 3] },
  { name: "ember", theme: "warm and glowing, like something faintly molten", hueStart: 350, hueSpan: 90, paletteMoodIndices: [0, 3], surfacePatternIndices: [0, 2], featureIndices: [5, 6, 10], eyeStyleIndices: [5, 7, 2] },
  { name: "aquatic", theme: "smooth and flowing, faintly wet-looking", hueStart: 180, hueSpan: 50, paletteMoodIndices: [0, 4], surfacePatternIndices: [0, 3], featureIndices: [3, 4, 10], eyeStyleIndices: [0, 4, 6] },
  { name: "aerial", theme: "light and downy, soft-bodied", hueStart: 40, hueSpan: 50, paletteMoodIndices: [1, 0], surfacePatternIndices: [0, 1], featureIndices: [0, 4, 2], eyeStyleIndices: [0, 7, 3] },
  { name: "stony", theme: "rough and chunky, mineral-like", hueStart: 20, hueSpan: 40, paletteMoodIndices: [3, 2], surfacePatternIndices: [3, 2], featureIndices: [5, 6, 9], eyeStyleIndices: [1, 4, 2] },
  { name: "shadow", theme: "dark and hazy, faintly indistinct at the edges", hueStart: 240, hueSpan: 40, paletteMoodIndices: [2, 4], surfacePatternIndices: [0, 3], featureIndices: [10, 11, 3], eyeStyleIndices: [5, 8, 6] },
  { name: "sheen", theme: "cool with a mineral-like shine", hueStart: 195, hueSpan: 30, paletteMoodIndices: [4, 0], surfacePatternIndices: [0, 2], featureIndices: [1, 9, 5], eyeStyleIndices: [1, 5, 9] },
  { name: "downy", theme: "fuzzy and warm to the eye", hueStart: 15, hueSpan: 40, paletteMoodIndices: [3, 1], surfacePatternIndices: [0, 1], featureIndices: [0, 3, 2], eyeStyleIndices: [0, 6, 3] },
];

// Total combinatorial space: 10 families x ~55 average hue span x 2
// palette moods x 2 surface patterns x 3 features x 11,340 silhouettes
// (see composeSilhouette, which stays fully independent of family) is on
// the order of tens of millions -- comfortably past "10,000+
// distinguishable results" (the user's bar, 2026-07-05) while every
// combination a given family can produce stays thematically coherent,
// unlike the fully-independent-axis version this replaced. This is
// combinatorics, not true randomness -- a 32-bit hash has ~4.29 billion
// possible values, comfortably more than needed here.
export function styleFromSeed(seed) {
  let remainder = seed;
  const family = MONSTER_FAMILIES[remainder % MONSTER_FAMILIES.length];
  remainder = Math.floor(remainder / MONSTER_FAMILIES.length);

  const hue = (family.hueStart + (remainder % family.hueSpan)) % 360;
  remainder = Math.floor(remainder / family.hueSpan);

  const paletteMoodIndex = family.paletteMoodIndices[remainder % family.paletteMoodIndices.length];
  remainder = Math.floor(remainder / family.paletteMoodIndices.length);
  const surfacePatternIndex = family.surfacePatternIndices[remainder % family.surfacePatternIndices.length];
  remainder = Math.floor(remainder / family.surfacePatternIndices.length);
  const featureIndex = family.featureIndices[remainder % family.featureIndices.length];
  remainder = Math.floor(remainder / family.featureIndices.length);
  const eyeStyleIndex = family.eyeStyleIndices[remainder % family.eyeStyleIndices.length];
  remainder = Math.floor(remainder / family.eyeStyleIndices.length);

  const { description: silhouette } = composeSilhouette(remainder);

  return {
    familyName: family.name,
    familyTheme: family.theme,
    hue,
    silhouette,
    feature: DISTINCTIVE_FEATURES[featureIndex],
    paletteMood: PALETTE_MOODS[paletteMoodIndex],
    surfacePattern: SURFACE_PATTERNS[surfacePatternIndex],
    eyeStyle: EYE_STYLES[eyeStyleIndex],
  };
}

// Each slot's purpose + a bounding-box hint, given to Claude so free-form
// SVG fragments stay roughly in place inside the fixed rig's viewBox.
//
// Deliberately an original monster/creature, never a human -- this
// sidesteps face/skin-tone representation entirely rather than trying to
// get it right, per direct user instruction (2026-07-04).
export const PART_SPECS = {
  "body-slot": {
    purpose:
      "the monster's main body/silhouette -- an original creature, not humanoid, not based on any existing franchise",
    bbox: "centered around (100,130), roughly 70x70",
  },
  "eyes-slot": {
    purpose: "the monster's eyes, reflecting its current mood",
    bbox: "centered around (100,90), roughly 40x15",
  },
  "mouth-slot": {
    purpose: "the monster's mouth/expression",
    bbox: "centered around (100,110), roughly 30x10",
  },
  "hat-slot": {
    purpose: "headgear reflecting the repository's current dominant technology (file types touched + commit message mentions)",
    bbox: "centered around (100,55), roughly 40x25",
  },
  "armor-slot": {
    purpose: "body armor/gear that becomes more elaborate as total commit count accumulates",
    bbox: "overlaid on the body, centered around (100,125), roughly 60x50",
  },
  "shoes-slot": {
    purpose: "footwear reflecting how consistently (spread across many days, not bursty) the repo is worked on",
    bbox: "centered around (100,165), roughly 50x20",
  },
};

// Deliberately describes the aesthetic generically (low-res retro
// handheld display, simple digital pet toy) rather than naming any
// specific game, console, or franchise -- per direct user instruction
// (2026-07-05): the visual direction should evoke that whole era without
// referencing anything specific/trademarked enough to invite a claim.
//
// Expanded 2026-07-05 after repeated dry runs converged on the same
// bland "layered rectangle pyramid" silhouette every time (a symmetric
// stack of same-width bands, flat single color per band, small dot
// eyes). Craft/charm guidance lives here since it applies to every part
// on every run; the *structural* variety fix (silhouette archetype,
// distinctive feature, hue) lives in buildInitialPrompt instead, as a
// concrete seed-derived instruction rather than a vague "please vary
// things" ask -- see styleFromSeed and .agent/plan.md (2026-07-05,
// "もっとランダム性がないとみんな同じものが作られる").
// Rect size and minimum count made explicit and concrete (2026-07-06)
// after real generated output came out too chunky and low-detail: a
// handful of 8-16 unit blocks reads as "blown up and coarse", not like
// an actual retro sprite. Classic small RPG monster sprites are built
// from a dense grid of individually-tiny pixels (often 32x32 to 64x64
// pixels for the whole creature), not a dozen big rectangles -- a vague
// "make it pixel art" instruction doesn't convey that density on its
// own, so the grid size and a minimum rect count are stated as hard
// numbers instead.
export const PIXEL_ART_RULES = `Draw everything as pixel art on a fine, consistent grid: every \
<rect> must be exactly 4 units square (width="4" height="4"), positioned on 4-unit boundaries \
(x and y both multiples of 4), no rounded corners, no gradients, no anti-aliased curves -- like \
a genuine retro sprite made of small individual pixels, not a handful of large blown-up blocks.

Use enough individual 4x4 rects to actually fill the silhouette in visible detail: the body \
alone should use at least 40 separate rects (not 8-12), covering its full area edge to edge \
with no gaps -- a sparse outline of a few big rectangles is not acceptable, only a dense grid \
of small ones is.

Rect count alone is not the goal -- many small rects arranged as a few perfectly flat, \
uniform-width rows still reads as coarse and blocky, just built from smaller pieces. To \
actually look like a genuine retro sprite: (1) step the silhouette's outline in and out by \
one pixel at a time between rows rather than keeping the same width for many rows in a row, \
and (2) scatter a handful of individual pixels in a slightly different, lighter or darker \
shade throughout each color band (not confined to a clean top/mid/bottom split) for a subtly \
dithered, textured look, rather than perfectly flat uniform bands of color.

For charm and appeal:
- Eyes should be noticeably large relative to the body (this reads as "cute" far more than \
a small dot does) -- and shaded, not flat: a dark base color plus a small lighter highlight \
rect for a glint.
- Shade the body with at least 3 tones of the same hue (a light tone where the "light" hits, \
a mid tone for most of the form, a dark tone for the underside/shadow), not one flat block of \
color per band -- this is what separates a lively sprite from a flat silhouette.`;

export function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude's response did not contain a parseable JSON object.");
  return JSON.parse(match[0]);
}

export function reasonForPart(partKey, traits, digest) {
  switch (partKey) {
    case "hat-slot":
      return "the repository's dominant technology (by file types touched and commit message mentions) has shifted";
    case "armor-slot":
      return `total commit count just crossed a multiple of ${ARMOR_MILESTONE_STEP} (now ${traits.totalCommits})`;
    case "shoes-slot":
      return `work has been spread steadily across many days rather than bursty (consistency score ${traits.consistencyScore.toFixed(2)})`;
    default:
      return "routine periodic mood refresh";
  }
}

export function buildInitialPrompt(digest) {
  const specLines = Object.entries(PART_SPECS)
    .map(([key, spec]) => `- "${key}": ${spec.purpose}. Keep it within ${spec.bbox}.`)
    .join("\n");
  // Concrete, seed-derived instructions instead of a vague "please vary
  // things" ask -- see styleFromSeed's comment for why. The seed comes
  // from the repo's permanent root commit, so this is the same for every
  // initial-design attempt on this repo but differs widely across repos.
  const { familyTheme, hue, silhouette, feature, paletteMood, surfacePattern, eyeStyle } = styleFromSeed(deriveIdentitySeed(digest.rootSha));
  return `Design an original monster/creature (not humanoid, not based on any \
existing franchise or trademarked design) that represents a software repository, in the \
style of an old-school digital pet/creature-collecting game era, with separate equipment \
slots. It will be assembled from independent SVG part slots inside a fixed template -- you are \
drawing the CONTENT of each slot, not a full document.

${PIXEL_ART_RULES}

This specific creature's identity (derived from this repository, so it won't match other \
repositories' creatures -- follow these concretely rather than choosing your own): it belongs \
to a design family best described as ${familyTheme}. Every choice below should read as \
consistent with that description, not just individually valid.
- Base the color palette around hue ${hue}° on the color wheel.
- The overall color mood should be ${paletteMood}.
- The body's overall silhouette should be: ${silhouette}.
- Give it ${feature} as its one distinctive feature.
- Render the body surface with ${surfacePattern}.
- The eyes should be: ${eyeStyle}.

Slots to design:
${specLines}

Rules for each part's SVG content:
- Return raw SVG child elements only (e.g. <rect .../>), no <svg> wrapper, no id or class \
attributes (the surrounding template supplies those).
- hat-slot, armor-slot, and shoes-slot are equipment and may be an empty string if nothing \
fits yet -- the base monster (body/eyes/mouth) should look complete on its own without them.

Repository's activity so far:
${digestToFacts(digest)}

Respond with ONLY a JSON object with exactly these keys: "body-slot", "eyes-slot", \
"mouth-slot", "hat-slot", "armor-slot", "shoes-slot" -- each a string of raw SVG markup (or \
"" for equipment slots you choose to skip). No commentary, no markdown fences.`;
}

export function buildUpdatePrompt(partKey, currentContent, traits, digest) {
  const spec = PART_SPECS[partKey];
  return `You are updating ONE equipment/body part of an evolving pixel-art monster \
character embedded in a GitHub README. This part is "${partKey}": ${spec.purpose}. It must \
stay within ${spec.bbox}.

${PIXEL_ART_RULES}

Current content of this part (raw SVG child elements, "(empty)" if this equipment slot \
hasn't been drawn yet):
${currentContent || "(empty)"}

If currently empty, design a new small piece of equipment for this slot. If not empty, make \
a SMALL, RECOGNIZABLE adjustment (e.g. tweak a color, add one small pixel-art detail) -- do \
not redesign it from scratch, and do not introduce id/class attributes or an <svg> wrapper.

Cumulative stats: ${traits.totalCommits} total commits, ${Math.round(traits.nightOwlRatio * 100)}% \
tend to be late-night, consistency score ${traits.consistencyScore.toFixed(2)} (0=bursty, 1=steady).
Reason this part was chosen for this update: ${reasonForPart(partKey, traits, digest)}.
Recent activity:
${digestToFacts(digest)}

Respond with ONLY a JSON object: {"${partKey}": "<updated raw SVG markup>"}. No commentary, \
no markdown fences.`;
}
