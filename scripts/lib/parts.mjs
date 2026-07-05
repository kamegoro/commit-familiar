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

// Total combinatorial space: 360 hues x 11,340 silhouettes (see
// composeSilhouette) x 12 features x 5 palette moods x 4 surface patterns
// = 979,776,000. Comfortably past "10,000+ distinguishable results" (the
// user's bar, 2026-07-05) for the silhouette axis alone, and orders of
// magnitude more once combined with the other axes. This is
// combinatorics, not true randomness -- a 32-bit hash has ~4.29 billion
// possible values, still more than the ~980M combinations here, so there
// is entropy to spare, but not by a huge margin; if more axes are added
// later, check this comment's math still fits under 2^32 before assuming
// it does.
export function styleFromSeed(seed) {
  const hue = seed % 360;
  let remainder = Math.floor(seed / 360);

  const { description: silhouette, remainder: afterSilhouette } = composeSilhouette(remainder);
  remainder = afterSilhouette;

  const featureIndex = remainder % DISTINCTIVE_FEATURES.length;
  remainder = Math.floor(remainder / DISTINCTIVE_FEATURES.length);
  const paletteMoodIndex = remainder % PALETTE_MOODS.length;
  remainder = Math.floor(remainder / PALETTE_MOODS.length);
  const surfacePatternIndex = remainder % SURFACE_PATTERNS.length;

  return {
    hue,
    silhouette,
    feature: DISTINCTIVE_FEATURES[featureIndex],
    paletteMood: PALETTE_MOODS[paletteMoodIndex],
    surfacePattern: SURFACE_PATTERNS[surfacePatternIndex],
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
export const PIXEL_ART_RULES = `Draw everything as pixel art: build shapes out of a grid of small \
axis-aligned <rect> elements (each rect roughly 4-8 units square, no rounded corners, no \
gradients, no anti-aliased curves), like a low-resolution retro handheld game display or a \
simple digital pet toy.

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
  const { hue, silhouette, feature, paletteMood, surfacePattern } = styleFromSeed(deriveIdentitySeed(digest.rootSha));
  return `Design an original monster/creature (not humanoid, not based on any \
existing franchise or trademarked design) that represents a software repository, in the \
style of an old-school digital pet/creature-collecting game era, with separate equipment \
slots. It will be assembled from independent SVG part slots inside a fixed template -- you are \
drawing the CONTENT of each slot, not a full document.

${PIXEL_ART_RULES}

This specific creature's identity (derived from this repository, so it won't match other \
repositories' creatures -- follow these concretely rather than choosing your own):
- Base the color palette around hue ${hue}° on the color wheel.
- The overall color mood should be ${paletteMood}.
- The body's overall silhouette should be: ${silhouette}.
- Give it ${feature} as its one distinctive feature.
- Render the body surface with ${surfacePattern}.

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
