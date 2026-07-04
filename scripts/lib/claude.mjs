// The only network I/O in this project: a single call to Anthropic's
// Messages API. `fetchImpl` is an injectable dependency (defaults to the
// global fetch) specifically so tests can stub the network boundary
// without making real API calls or requiring a live ANTHROPIC_API_KEY.

import { extractJsonObject, buildInitialPrompt, buildUpdatePrompt } from "./parts.mjs";

export async function callClaude({ apiKey, model, prompt, maxTokens, fetchImpl = fetch }) {
  const resp = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
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

export async function generateInitialParts({ apiKey, model, digest, fetchImpl }) {
  const prompt = buildInitialPrompt(digest);
  const text = await callClaude({ apiKey, model, prompt, maxTokens: 2000, fetchImpl });
  return extractJsonObject(text);
}

export async function updatePart({ apiKey, model, partKey, currentContent, traits, digest, fetchImpl }) {
  const prompt = buildUpdatePrompt(partKey, currentContent, traits, digest);
  const text = await callClaude({ apiKey, model, prompt, maxTokens: 500, fetchImpl });
  const obj = extractJsonObject(text);
  if (typeof obj[partKey] !== "string") throw new Error(`Response missing expected key "${partKey}".`);
  return obj[partKey];
}
