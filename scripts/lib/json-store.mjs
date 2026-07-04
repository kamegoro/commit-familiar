// Small filesystem helpers for the JSON state files (.familiar-parts.json,
// .familiar-traits.json, .familiar-state.json). Kept separate and tiny so
// their (intentionally forgiving) error handling is easy to verify in
// isolation.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Corrupt/missing state should never crash a scheduled run -- falling
// back to a safe default (treated the same as "first run ever") is
// preferable to an Action failing outright over a state file a user
// might have hand-edited or a run that got interrupted mid-write.
export function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function saveJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}
