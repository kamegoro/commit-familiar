// Pure logic: part definitions, prompt construction, and response
// parsing. No I/O -- everything here is a plain function of its inputs,
// so it's unit tested directly with no fixtures or network stubs.

import { ARMOR_MILESTONE_STEP, deriveIdentitySeed } from "./traits.mjs";
import { digestToFacts } from "./digest.mjs";

// Deliberately structurally different from each other (not just "round
// but slightly bigger") so that picking one by arithmetic actually forces
// a different silhouette, not a cosmetic variation on the same shape.
// Generic descriptions only -- no specific creature/franchise named.
//
// Expanded 2026-07-05: hue alone gives fine-grained numeric variety
// (360 values), but two nearby hues barely read as different to a human,
// and with only 10 archetypes x 8 features, the number of *structurally*
// distinguishable results was really just 80, not the "thousands, ideally
// never repeats" bar the user set. Multiplying more independent axes
// together, not widening any single one, is what actually gets there --
// see styleFromSeed for the combinatorics.
export const SILHOUETTE_ARCHETYPES = [
  "round and squat, wider than tall",
  "tall and narrow, taller than wide",
  "a long horizontal body low to the ground",
  "lumpy and asymmetric, with uneven bumps on one side",
  "segmented, built from 2-3 stacked sections of clearly different widths",
  "curving to one side like a coil or a crescent",
  "wedge-shaped, wide at the bottom tapering to a point at the top",
  "wedge-shaped, wide at the top tapering to a point at the bottom",
  "star-like, with several points radiating from a central mass",
  "blocky and angular, built from distinct rectangular chunks rather than a smooth curve",
  "an hourglass shape, narrow in the middle and wide at both the top and bottom",
  "a flat wide disc, much wider than it is tall",
  "a compact core with small stubby limb-like bumps poking out on both sides",
  "a single tall spire narrowing continuously from a wide base to a thin tip",
  "two round lobes of clearly different sizes joined together",
  "a zigzagging outline that steps in and out irregularly rather than a smooth silhouette",
];

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

// Derives several independent-feeling choices from one seed via a
// mixed-radix split (like extracting successive digits from one number),
// so the axes don't all just repeat the same modulo pattern against each
// other. The seed comes from the repo's permanent root commit SHA (see
// digest.mjs), so this is deterministic per repository -- same repo
// always designs toward the same identity -- but varies widely *across*
// different repositories: 360 hues x 16 archetypes x 12 features x 5
// palette moods x 4 surface patterns = 13,824,000 combinations, comfortably
// past "thousands of distinguishable results" and into "collisions
// between two different repos are practically negligible" territory. This
// is combinatorics, not true randomness -- a 32-bit hash has ~4.29
// billion possible values, far more than 13.8M combinations, so there's
// no risk of running out of entropy to split.
export function styleFromSeed(seed) {
  const hue = seed % 360;
  let remainder = Math.floor(seed / 360);
  const archetypeIndex = remainder % SILHOUETTE_ARCHETYPES.length;
  remainder = Math.floor(remainder / SILHOUETTE_ARCHETYPES.length);
  const featureIndex = remainder % DISTINCTIVE_FEATURES.length;
  remainder = Math.floor(remainder / DISTINCTIVE_FEATURES.length);
  const paletteMoodIndex = remainder % PALETTE_MOODS.length;
  remainder = Math.floor(remainder / PALETTE_MOODS.length);
  const surfacePatternIndex = remainder % SURFACE_PATTERNS.length;

  return {
    hue,
    archetype: SILHOUETTE_ARCHETYPES[archetypeIndex],
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
  const { hue, archetype, feature, paletteMood, surfacePattern } = styleFromSeed(deriveIdentitySeed(digest.rootSha));
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
- The body's overall silhouette should be ${archetype}.
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
