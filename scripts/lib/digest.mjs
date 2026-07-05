// Touches git (via execSync) to build a factual summary of recent
// activity. Tested via integration tests against a real temporary git
// repository (tests/integration/digest.test.mjs) rather than a mocked
// exec function, matching this project's general preference for real
// integration over mocking git behavior it doesn't own.
//
// Every fact here is either a count, a percentage, or file
// paths/extensions/commit-message text -- diff *content* is never read,
// by direct user instruction (2026-07-04).

import { execSync } from "node:child_process";

// "What tech is this repo about" is derived from two sources: file
// extensions touched (path metadata only, never diff content) and
// keywords mentioned in commit message text. See .agent/plan.md for why
// both are combined rather than picking one.
const KEYWORD_KINDS = [
  "rust", "python", "javascript", "typescript", "go", "golang", "ruby", "java", "kotlin",
  "swift", "lua", "c++", "csharp", "php", "docker", "kubernetes", "react", "vue", "svelte",
  "graphql", "sql", "terraform", "css", "html", "shell", "bash",
];

export function extractKeywordHits(messages) {
  const text = messages.join(" ").toLowerCase();
  const hits = {};
  for (const kw of KEYWORD_KINDS) {
    const count = (text.match(new RegExp(`\\b${kw.replace("+", "\\+")}\\b`, "g")) || []).length;
    if (count > 0) hits[kw] = count;
  }
  return hits;
}

// Parses one line of `uniq -c | sort -rn` output (e.g. "   3 lua") into
// {ext, count}. Pulled out as its own pure function specifically so the
// malformed-line fallback (returning null) is directly unit-testable --
// real `uniq -c` output always matches this shape, so exercising that
// branch through an actual git repo isn't practical, but the fallback
// itself is still worth keeping and verifying rather than assuming it's
// unreachable.
export function parseExtensionCountLine(line) {
  const m = line.trim().match(/^(\d+)\s+(.+)$/);
  return m ? { ext: m[2], count: parseInt(m[1], 10) } : null;
}

// Every other fact in the digest is naturally bounded (a count, a
// percentage, a top-5 list); the commit message list was the one
// exception that could grow without limit if a repo goes a long stretch
// between runs before finally clearing min-commits. Capped for cost
// predictability -- see .agent/plan.md (2026-07-05) for the token-cost
// investigation this came out of.
export const MAX_MESSAGES_IN_DIGEST = 15;

export function buildActivityDigest(sinceSha, cwd = process.cwd()) {
  const run = (cmd) => execSync(cmd, { cwd }).toString().trim();
  const range = sinceSha ? `${sinceSha}..HEAD` : "HEAD";
  // --no-merges throughout: a merge commit's message ("Merge pull request
  // #123 from ...") is pure noise for interpreting what a repo actually
  // did, and its timestamp is often auto-generated rather than reflecting
  // real work -- established practice in changelog tooling (e.g.
  // git-cliff), confirmed via research 2026-07-05. Also keeps commitCount
  // (and therefore whether min-commits is met) from being inflated by
  // merges that carry no real signal.
  const commitCount = parseInt(run(`git rev-list --no-merges --count ${range}`), 10);
  if (commitCount === 0) return null;

  const messages = run(`git log ${range} --no-merges --pretty=format:%s`).split("\n").filter(Boolean);
  const keywordHits = extractKeywordHits(messages);

  // On the very first run there's no checkpoint yet, so diff against the
  // repository's root commit (the true start of history) rather than an
  // ordinal HEAD~N guess -- HEAD~N would silently misalign once merge
  // commits exist, since commitCount above excludes them but HEAD~N
  // walks every commit regardless.
  // Always computed (not just when sinceSha is null): this is the
  // repository's permanent identity anchor, used to derive a stable
  // per-repo "style seed" (see traits.mjs's deriveIdentitySeed) for the
  // initial design -- it never changes for the life of the repo, unlike
  // sinceSha which advances every run.
  const rootSha = run("git rev-list --max-parents=0 HEAD").split("\n")[0];
  const base = sinceSha || rootSha;
  const filesChangedMatch = run(`git diff --stat ${base}..HEAD`).match(/(\d+) files? changed/);
  const filesChanged = filesChangedMatch ? parseInt(filesChangedMatch[1], 10) : 0;

  // File extensions only (path metadata) -- never diff content.
  const extensions = run(`git diff --name-only ${base}..HEAD | sed 's/.*\\.//' | sort | uniq -c | sort -rn`)
    .split("\n")
    .filter(Boolean)
    .map(parseExtensionCountLine)
    .filter(Boolean);

  // Commit hour distribution, used for the "night owl" trait -- cheap
  // local signal that needs no external data source.
  const hours = run(`git log ${range} --no-merges --pretty=format:%ad --date=format:%H`)
    .split("\n")
    .filter(Boolean)
    .map(Number);
  const nightCommits = hours.filter((h) => h >= 22 || h < 5).length;

  // Distinct calendar days touched, vs. commit count -- a proxy for
  // "spread evenly across days" (shoes/consistency) vs. "one big burst".
  const distinctDays = new Set(
    run(`git log ${range} --no-merges --pretty=format:%ad --date=format:%Y-%m-%d`).split("\n").filter(Boolean)
  ).size;

  return {
    commitCount,
    filesChanged,
    extensions,
    keywordHits,
    messages,
    // No hours.length === 0 guard here: `hours` counts the same
    // --no-merges commits in the same range as `commitCount`, and the
    // commitCount === 0 check above already returned early, so hours is
    // guaranteed non-empty at this point. A defensive fallback for a case
    // that can't happen would be untestable dead code, not safety.
    nightRatio: nightCommits / hours.length,
    distinctDays,
    rootSha,
  };
}

export function digestToFacts(digest) {
  const topExts = digest.extensions.slice(0, 5).map((e) => `${e.ext} (${e.count})`).join(", ") || "none";
  const topKeywords =
    Object.entries(digest.keywordHits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([kw, n]) => `${kw} (mentioned ${n}x)`)
      .join(", ") || "none detected";
  const shownMessages = digest.messages.slice(0, MAX_MESSAGES_IN_DIGEST);
  const omittedCount = digest.messages.length - shownMessages.length;
  const messageBlock =
    shownMessages.map((m) => `- ${m}`).join("\n") + (omittedCount > 0 ? `\n- ...and ${omittedCount} more` : "");
  return [
    `${digest.commitCount} commits since last update.`,
    `${digest.filesChanged} files changed.`,
    `Top file types touched: ${topExts}.`,
    `Technologies mentioned in commit messages: ${topKeywords}.`,
    `${Math.round(digest.nightRatio * 100)}% of these commits happened late night (22:00-05:00).`,
    `Commit messages:\n${messageBlock}`,
  ].join("\n");
}
