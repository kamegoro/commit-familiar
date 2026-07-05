import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderSvg, injectIntoReadme, README_MARKER_START, README_MARKER_END, DEFAULT_DISPLAY_WIDTH } from "../../scripts/lib/svg.mjs";

describe("renderSvg", () => {
  let dir, templatePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-svg-"));
    templatePath = join(dir, "template.svg");
    writeFileSync(
      templatePath,
      `<svg><g id="body-slot">{{BODY}}</g><g id="eyes-slot">{{EYES}}</g><g id="mouth-slot">{{MOUTH}}</g><g id="hat-slot">{{HAT}}</g><g id="armor-slot">{{ARMOR}}</g><g id="shoes-slot">{{SHOES}}</g></svg>`
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("substitutes every named slot", () => {
    const svg = renderSvg(
      {
        "body-slot": "<rect id='b'/>",
        "eyes-slot": "<rect id='e'/>",
        "mouth-slot": "<rect id='m'/>",
        "hat-slot": "<rect id='h'/>",
        "armor-slot": "<rect id='a'/>",
        "shoes-slot": "<rect id='s'/>",
      },
      templatePath
    );
    assert.doesNotMatch(svg, /\{\{/);
    for (const id of ["b", "e", "m", "h", "a", "s"]) {
      assert.match(svg, new RegExp(`id='${id}'`));
    }
  });

  test("leaves a slot blank when its content is missing", () => {
    const svg = renderSvg({ "body-slot": "<rect/>" }, templatePath);
    assert.match(svg, /<g id="eyes-slot"><\/g>/);
  });

  test("leaves a slot blank when its content is an explicit empty string", () => {
    const svg = renderSvg({ "hat-slot": "" }, templatePath);
    assert.match(svg, /<g id="hat-slot"><\/g>/);
  });
});

describe("injectIntoReadme", () => {
  let dir, readmePath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "commit-familiar-readme-"));
    readmePath = join(dir, "README.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns readme-missing when the file does not exist", () => {
    assert.equal(injectIntoReadme(join(dir, "nope.md"), "familiar.svg"), "readme-missing");
  });

  test("returns markers-not-found and leaves the file untouched when markers are absent", () => {
    const original = "# My Project\n\nSome text.\n";
    writeFileSync(readmePath, original);
    assert.equal(injectIntoReadme(readmePath, "familiar.svg"), "markers-not-found");
    assert.equal(readFileSync(readmePath, "utf8"), original);
  });

  test("returns markers-not-found when the end marker appears before the start marker", () => {
    writeFileSync(readmePath, `${README_MARKER_END}\n${README_MARKER_START}`);
    assert.equal(injectIntoReadme(readmePath, "familiar.svg"), "markers-not-found");
  });

  test("inserts the image between the markers and returns updated", () => {
    writeFileSync(readmePath, `# Title\n\n${README_MARKER_START}\n${README_MARKER_END}\n\n## Next section\n`);
    assert.equal(injectIntoReadme(readmePath, "familiar.svg"), "updated");
    const result = readFileSync(readmePath, "utf8");
    assert.match(result, /<img src="\.\/familiar\.svg" width="\d+" alt="familiar" \/>/);
    assert.match(result, /## Next section/);
  });

  test("uses the given displayWidth in the img tag", () => {
    writeFileSync(readmePath, `${README_MARKER_START}\n${README_MARKER_END}`);
    injectIntoReadme(readmePath, "familiar.svg", 250);
    assert.match(readFileSync(readmePath, "utf8"), /width="250"/);
  });

  test("falls back to DEFAULT_DISPLAY_WIDTH when no width is given", () => {
    writeFileSync(readmePath, `${README_MARKER_START}\n${README_MARKER_END}`);
    injectIntoReadme(readmePath, "familiar.svg");
    assert.match(readFileSync(readmePath, "utf8"), new RegExp(`width="${DEFAULT_DISPLAY_WIDTH}"`));
  });

  test("is idempotent: running it twice does not duplicate the image line", () => {
    writeFileSync(readmePath, `${README_MARKER_START}\n${README_MARKER_END}`);
    injectIntoReadme(readmePath, "familiar.svg");
    injectIntoReadme(readmePath, "familiar.svg");
    const occurrences = readFileSync(readmePath, "utf8").match(/<img src="\.\/familiar\.svg"/g);
    assert.equal(occurrences.length, 1);
  });

  test("leaves content before and after the markers untouched", () => {
    writeFileSync(readmePath, `Before text\n${README_MARKER_START}\n${README_MARKER_END}\nAfter text`);
    injectIntoReadme(readmePath, "familiar.svg");
    const result = readFileSync(readmePath, "utf8");
    assert.match(result, /^Before text/);
    assert.match(result, /After text$/);
  });
});
