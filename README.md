<div align="center">

# 🐾 commit-familiar

**A small pixel-art monster that lives in your README and grows from your actual commits — not a level number.**

commit-familiar asks Claude to read your repository's real commit activity and draw or adjust
one part of an original creature accordingly. No two repositories end up with the same
character, because no two repositories have the same history.

<a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue?style=flat"></a>
<a href="https://github.com/kamegoro/commit-familiar/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/kamegoro/commit-familiar?style=flat&logo=github&color=yellow"></a>

[How it works](#-how-it-works) • [Setup](#-setup) • [Customization](#-customization) • [vs similar projects](#-vs-similar-projects)

<!-- COMMIT-FAMILIAR:START -->
<!-- COMMIT-FAMILIAR:END -->

*This project's own README uses commit-familiar on itself — the monster above is grown from this repository's real commit history.*

</div>

---

## ✨ Why this exists

Several projects already grow a "pet" in your README from GitHub activity. They work by
leveling up one of a fixed set of pre-drawn sprites — a gacha-style pool where a
contribution just increments a number, and the pet's actual *species and form* never
reflect what you did.

commit-familiar has Claude look at what actually happened — commit messages, file types
touched, how steadily you work — and draw or edit the character accordingly. Two
repositories with different histories end up with genuinely different, unpredictable
monsters, not the same finite cast everyone else has.

## 🧩 How it works

The character is deliberately **not** one image Claude freely repaints every run:

- **A fixed rig** (`rig/template.svg`) — the group structure and the CSS animations that
  make the monster blink, hop, and sway. Hand-authored once, never touched by AI.
- **Independent parts** (`.familiar-parts.json`) — body, eyes, mouth, and three equipment
  slots (hat, armor, shoes), each stored separately.
- **One part updated per run.** A deterministic rule in code — not an LLM judgment call —
  decides which single slot changes, based on what actually happened:

  | Signal | Part updated |
  |---|---|
  | Total commit count crosses a multiple of 25 | 🛡️ armor |
  | Dominant technology (file types + commit message mentions) shifts | 🎩 hat |
  | Work is spread steadily across many days, not bursty | 👟 shoes |
  | An ordinary week | 👀 eyes / 👄 mouth (alternating) |

  Claude is only ever shown that one part's current content plus a factual summary of
  recent activity, and returns just that part's replacement — never the full SVG. This is
  a structural guarantee against the model quietly redesigning everything, not just a
  prompted request for restraint, and it keeps every API call small.

- **Growth has no ceiling.** Progress is tracked as several independent, continuously
  drifting stats (total commits, consistency, dominant technology) instead of a single
  level number that caps out.

The monster is deliberately an original creature, not a human character — this sidesteps
face/skin-tone representation entirely rather than trying to get it right.

## 📦 Setup

1. Add `ANTHROPIC_API_KEY` as a secret in your repository (Settings → Secrets and
   variables → Actions). This project only ever calls the official Anthropic API with a
   key you control — nothing is sent anywhere else, and no file contents/diffs are ever
   read, only file extensions and commit message text.
2. Copy [`examples/workflow.yml`](./examples/workflow.yml) to
   `.github/workflows/commit-familiar.yml`.
3. Add these two lines anywhere in your README, wherever you want the monster to sit:
   ```md
   <!-- COMMIT-FAMILIAR:START -->
   <!-- COMMIT-FAMILIAR:END -->
   ```
   The action fills in the `![familiar](...)` image between them and keeps it updated —
   everything outside the markers is left alone.
4. Run the workflow once manually (Actions tab → Commit Familiar → Run workflow) to
   generate the first version, then let the schedule in your own workflow file take over.

## ⚙️ Customization

Run **frequency** is entirely up to the cron schedule in your own workflow file — this
action doesn't control that. What it does let you configure (as `with:` inputs, see
[`examples/workflow.yml`](./examples/workflow.yml)):

| Input | Default | Meaning |
|---|---|---|
| `min-commits` | `1` | Don't update unless at least this many commits landed since the last update, even if your cron fires more often. Commits below the threshold carry over to the next run instead of being dropped. |
| `readme-path` | `README.md` | Where to look for the embed markers. |
| `svg-path` | `familiar.svg` | Where the rendered character is written. |
| `model` | `claude-sonnet-5` | Model used for the one-time initial design. |

## 🆚 vs similar projects

| Project | What it does | vs commit-familiar |
|---|---|---|
| [gitanimals](https://github.com/git-goods/gitanimals) | Grows one of ~50 pre-drawn pet sprites via a gacha-style spawn table; contributions increment a random pet's level | Fixed, finite cast for everyone — commit-familiar's form is shaped by what you actually did, not a level counter |
| [commitmon](https://github.com/doongjun/commitmon) | Levels up a Digimon-style sprite from commits | Same finite-sprite-pool limitation |
| [commit-pet](https://github.com/yukurash/commit-pet) | A pixel pet that grows with commits | No AI interpretation of activity content |

commit-familiar is the only one of these where the character's actual design is shaped by
what a repository's commits say, not by a shared, finite sprite table.

## 💰 Cost

You pay for your own Claude API usage, the same model as `claude-code-action`. Initial
design uses a stronger model once; every regular update uses a smaller model on a
narrow, single-part task — a run against a small commit digest costs a fraction of a cent.

## 🧪 Verifying the pipeline without an API key

`scripts/dry-run-prompt.mjs` and `scripts/dry-run-apply.mjs` let you sanity-check the
entire pipeline — activity digest, part selection, JSON parsing, SVG rendering, README
embedding — without `ANTHROPIC_API_KEY` or any real API cost. The only piece they don't
exercise is the actual network call: a Claude Code session reads the exact prompt a real
run would send and writes the response itself, then everything else runs through the
same production code and the same production file paths a real run uses.

```bash
node scripts/dry-run-prompt.mjs                       # prints the real prompt
# (write a response following the prompt's rules to a file)
node scripts/dry-run-apply.mjs path/to/response.json  # applies it for real
```

See [`.claude/skills/verify-familiar`](./.claude/skills/verify-familiar) for the full,
Claude-Code-invocable version of this workflow.

## License

MIT
