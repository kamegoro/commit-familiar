#!/usr/bin/env node
// commit-familiar orchestrator.
//
// Architecture (see .agent/plan.md for the full rationale): the SVG is
// split into a fixed, hand-authored "rig" (rig/template.svg -- named
// group slots + CSS keyframe animation, never touched by AI) and
// separately-stored "parts" content for each slot (parts.json). Claude is
// only ever shown, and only ever allowed to return, ONE part's content at
// a time in a narrow JSON shape -- never the full SVG. This is a
// structural guarantee against "the model quietly redesigns everything",
// not just a prompted request for restraint, and it keeps each API call
// small (lower token cost) since the rig and untouched parts never need
// to round-trip through the model at all.
//
// Growth is tracked as several independent continuous stats (traits.json)
// rather than a single level number, so it has no ceiling and two repos
// with different histories drift apart in multiple dimensions rather than
// converging once both hit "max level".

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SVG_PATH = process.env.FAMILIAR_SVG_PATH || "familiar.svg";
const PARTS_PATH = process.env.FAMILIAR_PARTS_PATH || ".familiar-parts.json";
const TRAITS_PATH = process.env.FAMILIAR_TRAITS_PATH || ".familiar-traits.json";
const STATE_PATH = process.env.FAMILIAR_STATE_PATH || ".familiar-state.json";
const README_PATH = process.env.FAMILIAR_README_PATH || "README.md";
// "Should this run actually do anything" threshold -- distinct from run
// *frequency*, which is left entirely to whatever cron schedule the
// caller sets up. This only guards against updating on a trivially small
// amount of activity (e.g. a single typo-fix commit) even if the caller's
// cron fires more often than that.
const MIN_COMMITS = parseInt(process.env.FAMILIAR_MIN_COMMITS || "1", 10);
// A part-update call is a narrow, small task (pick/tweak one slot's
// content) -- it does not need the top-tier model. Only the one-time
// initial full-character design uses the stronger default below.
const UPDATE_MODEL = process.env.FAMILIAR_UPDATE_MODEL || "claude-haiku-4-5-20251001";
const INIT_MODEL = process.env.FAMILIAR_INIT_MODEL || "claude-sonnet-5";

const README_MARKER_START = "<!-- COMMIT-FAMILIAR:START -->";
const README_MARKER_END = "<!-- COMMIT-FAMILIAR:END -->";

if (!ANTHROPIC_API_KEY) {
  console.error("commit-familiar: ANTHROPIC_API_KEY is not set. See README for setup.");
  process.exit(1);
}

// Each slot's purpose + a bounding-box hint, given to Claude so free-form
// SVG fragments stay roughly in place inside the fixed rig's viewBox.
//
// Deliberately an original monster/creature, never a human -- this
// sidesteps face/skin-tone representation entirely rather than trying to
// get it right, per direct user instruction (2026-07-04).
const PART_SPECS = {
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
const PIXEL_ART_RULES = `Draw everything as pixel art: build shapes out of a grid of small \
axis-aligned <rect> elements (each rect roughly 4-8 units square, no rounded corners, no \
gradients, no anti-aliased curves), like a low-resolution retro handheld game display or a \
simple digital pet toy. Flat, limited color palette per part (2-4 colors).`;

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
const saveJson = (path, obj) => writeFileSync(path, JSON.stringify(obj, null, 2));

// "What tech is this repo about" is derived from two sources: file
// extensions touched (richer signal, but only ever path/extension
// metadata -- never diff content) and keywords mentioned in commit
// message text (extractKeywordHits). Originally built extension-only,
// then narrowed to message-only over a privacy concern, then the user
// explicitly said self-hosted + self-keyed + own repo makes this
// self-responsibility and asked to just use whatever signal works best
// (2026-07-04) -- so both are combined for the strongest signal. Still
// never touches file *contents*/diffs, only paths and commit text.
const KEYWORD_KINDS = [
  "rust", "python", "javascript", "typescript", "go", "golang", "ruby", "java", "kotlin",
  "swift", "lua", "c++", "csharp", "php", "docker", "kubernetes", "react", "vue", "svelte",
  "graphql", "sql", "terraform", "css", "html", "shell", "bash",
];

function extractKeywordHits(messages) {
  const text = messages.join(" ").toLowerCase();
  const hits = {};
  for (const kw of KEYWORD_KINDS) {
    const count = (text.match(new RegExp(`\\b${kw.replace("+", "\\+")}\\b`, "g")) || []).length;
    if (count > 0) hits[kw] = count;
  }
  return hits;
}

function buildActivityDigest(sinceSha) {
  const range = sinceSha ? `${sinceSha}..HEAD` : "HEAD";
  const commitCount = parseInt(execSync(`git rev-list --count ${range}`).toString().trim(), 10);
  if (commitCount === 0) return null;

  const messages = execSync(`git log ${range} --pretty=format:%s`).toString().trim().split("\n").filter(Boolean);
  const keywordHits = extractKeywordHits(messages);

  const base = sinceSha ? sinceSha : `HEAD~${commitCount}`;
  const filesChangedMatch = execSync(`git diff --stat ${base}..HEAD`).toString().trim().match(/(\d+) files? changed/);
  const filesChanged = filesChangedMatch ? parseInt(filesChangedMatch[1], 10) : 0;

  // File extensions only (path metadata) -- never diff content.
  const extensions = execSync(`git diff --name-only ${base}..HEAD | sed 's/.*\\.//' | sort | uniq -c | sort -rn`)
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.+)$/);
      return m ? { ext: m[2], count: parseInt(m[1], 10) } : null;
    })
    .filter(Boolean);

  // Commit hour distribution, used for the "night owl" trait -- cheap
  // local signal that needs no external data source.
  const hours = execSync(`git log ${range} --pretty=format:%ad --date=format:%H`)
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number);
  const nightCommits = hours.filter((h) => h >= 22 || h < 5).length;

  // Distinct calendar days touched, vs. commit count -- a proxy for
  // "spread evenly across days" (shoes/consistency) vs. "one big burst".
  const distinctDays = new Set(
    execSync(`git log ${range} --pretty=format:%ad --date=format:%Y-%m-%d`).toString().trim().split("\n").filter(Boolean)
  ).size;

  return {
    commitCount,
    filesChanged,
    extensions,
    keywordHits,
    messages,
    nightRatio: hours.length ? nightCommits / hours.length : 0,
    distinctDays,
  };
}

function digestToFacts(digest) {
  const topExts = digest.extensions.slice(0, 5).map((e) => `${e.ext} (${e.count})`).join(", ") || "none";
  const topKeywords =
    Object.entries(digest.keywordHits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw, n]) => `${kw} (mentioned ${n}x)`)
      .join(", ") || "none detected";
  return [
    `${digest.commitCount} commits since last update.`,
    `${digest.filesChanged} files changed.`,
    `Top file types touched: ${topExts}.`,
    `Technologies mentioned in commit messages: ${topKeywords}.`,
    `${Math.round(digest.nightRatio * 100)}% of these commits happened late night (22:00-05:00).`,
    `Commit messages:\n${digest.messages.map((m) => `- ${m}`).join("\n")}`,
  ].join("\n");
}

const ARMOR_MILESTONE_STEP = 25;

function topEntry(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0];
}

// Cumulative, multi-dimensional, uncapped -- see file header. Each field
// keeps drifting forever; there is no "max level" state.
function updateTraits(traits, digest) {
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

// Deterministic, in code -- Claude is never asked "which part should
// change", only "here is the one part you're updating". Keeps the model
// call narrow and keeps this decision inspectable/debuggable as plain
// logic rather than an LLM judgment call. Priority order reflects which
// signal is rarest/most notable; routine mood (eyes/mouth) is the
// fallback for an ordinary week.
function pickPartToUpdate(traits, digest, runIndex) {
  if (traits.armorMilestoneCrossed) return "armor-slot"; // commit-count milestone
  if (traits.dominantIdentityChanged) return "hat-slot"; // tech identity shifted
  if (traits.consistencyScore >= 0.6 && digest.commitCount >= 3) return "shoes-slot"; // steady, spread-out work
  return runIndex % 2 === 0 ? "eyes-slot" : "mouth-slot";
}

async function callClaude(model, prompt, maxTokens) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API error: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return data.content.map((b) => b.text ?? "").join("");
}

function extractJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const match = candidate.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Claude's response did not contain a parseable JSON object.");
  return JSON.parse(match[0]);
}

function reasonForPart(partKey, traits, digest) {
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

async function generateInitialParts(digest) {
  const specLines = Object.entries(PART_SPECS)
    .map(([key, spec]) => `- "${key}": ${spec.purpose}. Keep it within ${spec.bbox}.`)
    .join("\n");
  const prompt = `Design an original monster/creature (not humanoid, not based on any \
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

  const text = await callClaude(INIT_MODEL, prompt, 2000);
  return extractJsonObject(text);
}

async function updatePart(partKey, currentContent, traits, digest) {
  const spec = PART_SPECS[partKey];
  const prompt = `You are updating ONE equipment/body part of an evolving pixel-art monster \
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

  const text = await callClaude(UPDATE_MODEL, prompt, 500);
  const obj = extractJsonObject(text);
  if (typeof obj[partKey] !== "string") throw new Error(`Response missing expected key "${partKey}".`);
  return obj[partKey];
}

function renderSvg(parts) {
  let svg = readFileSync(join(__dirname, "..", "rig", "template.svg"), "utf8");
  svg = svg
    .replace("{{BODY}}", parts["body-slot"] || "")
    .replace("{{EYES}}", parts["eyes-slot"] || "")
    .replace("{{MOUTH}}", parts["mouth-slot"] || "")
    .replace("{{HAT}}", parts["hat-slot"] || "")
    .replace("{{ARMOR}}", parts["armor-slot"] || "")
    .replace("{{SHOES}}", parts["shoes-slot"] || "");
  return svg;
}

// Auto-embeds the character into README.md between two marker comments,
// so setup is "paste two marker lines once" rather than "remember to add
// an <img> tag and keep it pointed at the right path". No-ops (with a
// hint) if the markers aren't present, rather than guessing where to
// insert into a README it doesn't otherwise understand -- this is meant
// to sit as a small aside next to other README content, not to take over
// the file's layout.
function injectIntoReadme() {
  if (!existsSync(README_PATH)) return;
  const readme = readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(README_MARKER_START);
  const endIdx = readme.indexOf(README_MARKER_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    console.log(
      `commit-familiar: no ${README_MARKER_START} / ${README_MARKER_END} markers found in ${README_PATH} -- skipping auto-embed. Add the two marker lines where you want the character to appear.`
    );
    return;
  }
  const before = readme.slice(0, startIdx + README_MARKER_START.length);
  const after = readme.slice(endIdx);
  const block = `\n![familiar](./${SVG_PATH})\n`;
  writeFileSync(README_PATH, `${before}${block}${after}`);
  console.log(`commit-familiar: updated embed in ${README_PATH}.`);
}

async function main() {
  const state = loadJson(STATE_PATH, { lastSha: null, runIndex: 0 });
  const digest = buildActivityDigest(state.lastSha);

  if (!digest) {
    console.log("commit-familiar: no new commits since last run, nothing to do.");
    return;
  }
  if (digest.commitCount < MIN_COMMITS) {
    // Deliberately does NOT advance state.lastSha: these commits should
    // still count toward the threshold on the next run, not be dropped.
    console.log(
      `commit-familiar: only ${digest.commitCount} commit(s) since last update, below FAMILIAR_MIN_COMMITS=${MIN_COMMITS} -- waiting for more.`
    );
    return;
  }

  let parts = loadJson(PARTS_PATH, null);
  let traits = loadJson(TRAITS_PATH, {});
  traits = { ...traits, ...updateTraits(traits, digest) };

  if (!parts) {
    console.log("commit-familiar: no existing character found, designing the initial version...");
    parts = await generateInitialParts(digest);
  } else {
    const partKey = pickPartToUpdate(traits, digest, state.runIndex);
    console.log(`commit-familiar: updating "${partKey}"...`);
    const updated = await updatePart(partKey, parts[partKey], traits, digest);
    parts = { ...parts, [partKey]: updated };
  }

  const svg = renderSvg(parts);
  writeFileSync(SVG_PATH, svg);
  saveJson(PARTS_PATH, parts);
  saveJson(TRAITS_PATH, traits);
  injectIntoReadme();

  const headSha = execSync("git rev-parse HEAD").toString().trim();
  saveJson(STATE_PATH, { lastSha: headSha, runIndex: state.runIndex + 1, updatedAt: new Date().toISOString() });
  console.log(`commit-familiar: wrote ${SVG_PATH}.`);
}

main().catch((err) => {
  console.error("commit-familiar: failed —", err.message);
  process.exit(1);
});
