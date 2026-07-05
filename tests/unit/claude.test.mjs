import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { callClaude, generateInitialParts, updatePart } from "../../scripts/lib/claude.mjs";

// No real network calls anywhere in this file -- fetchImpl is always a
// stub, so these tests never require a live ANTHROPIC_API_KEY and never
// spend real API credit.

// Mirrors how callClaude actually uses a Response: .text() is only ever
// called on the !ok (error) path, .json() only on the ok path -- so
// there's no need for a fake body that could serve as either.
function fakeOkFetch(jsonBody) {
  return async () => ({ ok: true, json: async () => jsonBody });
}

function fakeErrorFetch(status, textBody) {
  return async () => ({ ok: false, status, text: async () => textBody });
}

describe("callClaude", () => {
  test("returns the concatenated text of all content blocks", async () => {
    const fetchImpl = fakeOkFetch({ content: [{ text: "hello " }, { text: "world" }] });
    const result = await callClaude({ apiKey: "k", model: "m", prompt: "p", maxTokens: 10, fetchImpl });
    assert.equal(result, "hello world");
  });

  test("treats a content block with no text field as an empty string", async () => {
    const fetchImpl = fakeOkFetch({ content: [{ type: "other" }] });
    const result = await callClaude({ apiKey: "k", model: "m", prompt: "p", maxTokens: 10, fetchImpl });
    assert.equal(result, "");
  });

  test("throws with the status and body when the API responds with an error", async () => {
    const fetchImpl = fakeErrorFetch(429, "rate limited");
    await assert.rejects(
      () => callClaude({ apiKey: "k", model: "m", prompt: "p", maxTokens: 10, fetchImpl }),
      /Anthropic API error: 429 rate limited/
    );
  });

  test("sends the API key, model, and prompt in the request", async () => {
    let capturedInit;
    const fetchImpl = async (url, init) => {
      capturedInit = init;
      return { ok: true, json: async () => ({ content: [{ text: "ok" }] }) };
    };
    await callClaude({ apiKey: "secret-key", model: "claude-x", prompt: "draw a monster", maxTokens: 42, fetchImpl });
    assert.equal(capturedInit.headers["x-api-key"], "secret-key");
    const body = JSON.parse(capturedInit.body);
    assert.equal(body.model, "claude-x");
    assert.equal(body.max_tokens, 42);
    assert.equal(body.messages[0].content, "draw a monster");
  });
});

describe("generateInitialParts", () => {
  const digest = { commitCount: 1, filesChanged: 1, extensions: [], keywordHits: {}, messages: ["feat: x"], nightRatio: 0, rootSha: "abc123" };

  test("parses the model's JSON response into a parts object", async () => {
    const parts = { "body-slot": "<rect/>", "eyes-slot": "", "mouth-slot": "", "hat-slot": "", "armor-slot": "", "shoes-slot": "" };
    const fetchImpl = fakeOkFetch({ content: [{ text: JSON.stringify(parts) }] });
    const result = await generateInitialParts({ apiKey: "k", model: "m", digest, fetchImpl });
    assert.deepEqual(result, parts);
  });

  test("requests enough tokens for a densely-detailed response (raised 2026-07-06)", async () => {
    let capturedBody;
    const fetchImpl = async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ text: '{"body-slot": ""}' }] }) };
    };
    await generateInitialParts({ apiKey: "k", model: "m", digest, fetchImpl });
    assert.equal(capturedBody.max_tokens, 4000);
  });
});

describe("updatePart", () => {
  const digest = { commitCount: 1, filesChanged: 1, extensions: [], keywordHits: {}, messages: ["feat: x"], nightRatio: 0 };
  const traits = { totalCommits: 5, nightOwlRatio: 0, consistencyScore: 0 };

  test("returns the updated content for the requested part", async () => {
    const fetchImpl = fakeOkFetch({ content: [{ text: '{"hat-slot": "<rect fill=\\"red\\"/>"}' }] });
    const result = await updatePart({ apiKey: "k", model: "m", partKey: "hat-slot", currentContent: "", traits, digest, fetchImpl });
    assert.equal(result, '<rect fill="red"/>');
  });

  test("throws when the response is missing the expected part key", async () => {
    const fetchImpl = fakeOkFetch({ content: [{ text: '{"wrong-key": "<rect/>"}' }] });
    await assert.rejects(
      () => updatePart({ apiKey: "k", model: "m", partKey: "hat-slot", currentContent: "", traits, digest, fetchImpl }),
      /Response missing expected key "hat-slot"/
    );
  });

  test("requests enough tokens for a densely-detailed response (raised 2026-07-06)", async () => {
    let capturedBody;
    const fetchImpl = async (url, init) => {
      capturedBody = JSON.parse(init.body);
      return { ok: true, json: async () => ({ content: [{ text: '{"hat-slot": ""}' }] }) };
    };
    await updatePart({ apiKey: "k", model: "m", partKey: "hat-slot", currentContent: "", traits, digest, fetchImpl });
    assert.equal(capturedBody.max_tokens, 1200);
  });
});
