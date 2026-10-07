// @group unit
// Unit tests for the OpenRouter client helpers that do NOT require a network
// call: robust JSON extraction from model responses.
import { test } from "node:test";
import assert from "node:assert";
import { parseJsonFromText, AiRequestError } from "../../src/server/ai/openrouter.ts";

test("parseJsonFromText parses a bare JSON object", () => {
  assert.deepEqual(parseJsonFromText('{"candidates":["https://a/1.png"]}'), {
    candidates: ["https://a/1.png"],
  });
});

test("parseJsonFromText unwraps ```json fences", () => {
  const text = 'Вот результат:\n```json\n{"description":"ok"}\n```\n';
  assert.deepEqual(parseJsonFromText(text), { description: "ok" });
});

test("parseJsonFromText unwraps unlabelled fences", () => {
  assert.deepEqual(parseJsonFromText("```\n{\"a\":1}\n```"), { a: 1 });
});

test("parseJsonFromText extracts JSON embedded in prose", () => {
  assert.deepEqual(parseJsonFromText('prefix {"a":[1,2]} suffix'), { a: [1, 2] });
});

test("parseJsonFromText parses arrays", () => {
  assert.deepEqual(parseJsonFromText('["x","y"]'), ["x", "y"]);
});

test("parseJsonFromText throws AiRequestError on unparseable text", () => {
  assert.throws(() => parseJsonFromText("no json here"), AiRequestError);
});