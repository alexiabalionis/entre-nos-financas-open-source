import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletionsPayload, modelId } from "../src/server/llm.ts";

const payload = (model: string) => ({ model, instructions: "i", input: "{}", json: true, max_output_tokens: 3000 });

test("sem sufixo, o pensamento fica desligado e o modo JSON continua", () => {
  const body = chatCompletionsPayload(payload("qwen3.8-flash"), "dashscope") as Record<string, unknown>;
  assert.equal(body.model, "qwen3.8-flash");
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.max_tokens, 3000);
});

test(":thinking liga o pensamento, tira o modo JSON e manda o id sem o sufixo", () => {
  const body = chatCompletionsPayload(payload("qwen3.7-plus:thinking"), "dashscope") as Record<string, unknown>;
  assert.equal(body.model, "qwen3.7-plus");
  assert.equal(body.enable_thinking, true);
  assert.equal(body.thinking_budget, 4000);
  assert.equal(body.response_format, undefined);
  assert.equal(body.max_tokens, 7000);
});

test("modelId tira só o sufixo", () => {
  assert.equal(modelId("deepseek-v4.1-flash:thinking"), "deepseek-v4.1-flash");
  assert.equal(modelId("glm-5.3"), "glm-5.3");
});
