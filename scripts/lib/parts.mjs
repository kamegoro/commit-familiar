// Pure logic: part definitions, prompt construction, and response
// parsing. No I/O -- everything here is a plain function of its inputs,
// so it's unit tested directly with no fixtures or network stubs.

import { ARMOR_MILESTONE_STEP } from "./traits.mjs";
import { digestToFacts } from "./digest.mjs";

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
export const PIXEL_ART_RULES = `Draw everything as pixel art: build shapes out of a grid of small \
axis-aligned <rect> elements (each rect roughly 4-8 units square, no rounded corners, no \
gradients, no anti-aliased curves), like a low-resolution retro handheld game display or a \
simple digital pet toy. Flat, limited color palette per part (2-4 colors).`;

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
  return `Design an original monster/creature (not humanoid, not based on any \
existing franchise or trademarked design) that represents a software repository, in the \
style of an old-school digital pet/creature-collecting game era, with separate equipment \
slots. It will be assembled from independent SVG part slots inside a fixed template -- you are \
drawing the CONTENT of each slot, not a full document.

${PIXEL_ART_RULES}

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
