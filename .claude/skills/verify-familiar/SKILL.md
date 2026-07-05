---
name: verify-familiar
description: Dry-run commit-familiar's character generation without an ANTHROPIC_API_KEY or any real API cost, by having Claude itself act as the model. Writes to the same production files a real run would (familiar.svg, .familiar-parts.json, .familiar-traits.json, .familiar-state.json, README.md).
---

# verify-familiar

Runs commit-familiar's real pipeline end to end, except the one network
call (Claude generating/editing a part) is fulfilled by the Claude Code
session itself reasoning through the prompt, instead of a real HTTP
request to the Anthropic API. Everything else -- reading git activity,
picking which part to update, parsing the response, rendering the SVG,
embedding it in the README, advancing the checkpoint -- is the exact same
`scripts/lib/*.mjs` code a real, API-key-backed run uses. This exists so
the pipeline can be sanity-checked repeatedly, for free, before ever
registering `ANTHROPIC_API_KEY` as a real secret.

## When to use this

Whenever asked to "test commit-familiar", "verify the character
generation", "dry-run this", or similar -- without a live API key
available or before the user wants to spend real API credit.

## Steps

1. Run `node scripts/dry-run-prompt.mjs` from the repository root.
   - If it prints "no new commits" or "below FAMILIAR_MIN_COMMITS", stop
     and report that -- there is nothing to verify until there's new
     activity to work from.
   - Otherwise it prints either an "=== INITIAL DESIGN PROMPT ===" or an
     `=== UPDATE PROMPT for "<part>" ===`, followed by the exact prompt
     text a real API call would send.

2. **Act as the model.** Read the printed prompt like you would if you
   were the one being called via the API, and compose the SVG content it
   asks for, following its rules exactly:
   - Raw `<rect>`-only pixel-art markup, no `<svg>` wrapper, no `id`/
     `class` attributes.
   - Stay within the given bounding box for each slot.
   - Never name a specific game, console, or franchise (see the "no
     trademarked names" rule in `CLAUDE.md`).
   - For an update prompt: a SMALL, recognizable adjustment to the
     existing content, not a redesign -- or a new small design if the
     slot was empty.
   - **Put real effort into charm and variety, not just a valid
     shape.** The prompt itself (`PIXEL_ART_RULES`) now spells out
     specific guidance for this -- big shaded eyes, 3+ tones per body
     part, one distinctive silhouette feature -- because early dry runs
     kept converging on the same bland "symmetric stack of rectangles
     narrowing top and bottom, flat single-color bands, tiny dot eyes"
     result every single time (2026-07-05 user feedback: "何度やり直し
     ても変わらないし、可愛くなさすぎる" -- doesn't change no matter how
     many times you redo it, and it's not cute enough). Follow that
     guidance for real, and genuinely vary the silhouette/hue between
     separate initial-design runs instead of reusing your last design's
     shape out of habit.

3. Write your response as a single JSON object matching the shape the
   prompt asked for (all 6 part keys for an initial design; exactly one
   key for a part update) to a temporary file, e.g.
   `/tmp/familiar-dryrun-response.json`.

4. Run `node scripts/dry-run-apply.mjs /tmp/familiar-dryrun-response.json`.
   This parses your response with the same `extractJsonObject` a real run
   uses, merges it into `.familiar-parts.json`, renders `familiar.svg` via
   the same `renderSvg`, embeds it in `README.md` via the same
   `injectIntoReadme`, and advances `.familiar-state.json` -- identical
   file paths and identical code to a real run.

5. Render `familiar.svg` to a viewable image and look at it, e.g.:
   ```bash
   rsvg-convert -w 400 -h 400 familiar.svg -o /tmp/familiar-preview.png
   ```
   Then read `/tmp/familiar-preview.png` to actually see the result --
   don't just trust that the pipeline ran without errors.

6. Report what changed: which part was updated (or that this was the
   initial design), and show the rendered image.

## Notes

- This intentionally reuses the same real file paths a production run
  uses (`familiar.svg`, `.familiar-parts.json`, etc.), not throwaway
  `/tmp` copies, so what you see is exactly what a real run would produce.
  Only `familiar.svg` and `README.md` are ever meant to be committed --
  `.familiar-parts.json`, `.familiar-traits.json`, `.familiar-state.json`,
  and `.familiar-dryrun-meta.json` are all gitignored (growth state lives
  in the GitHub Actions cache in a real deployment, see
  `examples/workflow.yml`, specifically so this doesn't clutter a repo
  with auto-generated files beyond the one image that actually needs to
  be there). `git status` will still show them as modified if the repo
  used to track them before this design changed; if the user wants to
  discard a dry run's effect entirely, `git checkout -- familiar.svg
  README.md` reverts the two tracked files, and the gitignored JSON files
  can simply be deleted (or left as local-only scratch state -- they
  don't affect the repo either way).
- Never fabricate what the real API/model would do beyond genuinely
  reasoning through the prompt -- the whole point is an honest check of
  whether the prompt design produces sensible output, not a rubber stamp.
