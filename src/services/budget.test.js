import { test, expect } from "bun:test";
import { createBudget } from "./budget.js";

const LIMITS = { maxTurns: 2, maxTokens: 1000, maxSeconds: 60, maxCost: 1 };
const reply = (stopReason, input = 10, output = 10, cost = 0) => ({
	type: "message_end",
	message: { role: "assistant", stopReason, usage: { input, output, cost: { total: cost } } },
});

test("tools run while under budget", async () => {
	const b = createBudget(LIMITS);
	b.onEvent({ type: "turn_start" });
	b.onEvent(reply("toolUse"));
	expect(await b.beforeToolCall()).toBeUndefined();
	expect(b.report().stopped).toBeUndefined();
});

test("max turns blocks the next tools", async () => {
	const b = createBudget(LIMITS);
	for (let i = 0; i < 2; i++) {
		b.onEvent({ type: "turn_start" });
		b.onEvent(reply("toolUse"));
	}
	expect(await b.beforeToolCall()).toMatchObject({ block: true, terminate: true });
	expect(b.report()).toMatchObject({ stopped: "maxTurns", used: { turns: 2, tokens: 40 } });
});

test("tokens and cost are summed across turns", () => {
	const b = createBudget(LIMITS);
	b.onEvent(reply("toolUse", 600, 100, 0.4));
	b.onEvent(reply("toolUse", 600, 100, 0.4));
	expect(b.report()).toMatchObject({ stopped: "maxTokens", used: { tokens: 1400 } });

	const c = createBudget({ ...LIMITS, maxTokens: 1e9 });
	c.onEvent(reply("toolUse", 1, 1, 0.6));
	c.onEvent(reply("toolUse", 1, 1, 0.6));
	expect(c.report().stopped).toBe("maxCost");
});

test("a final answer is never counted as a stop", () => {
	const b = createBudget({ ...LIMITS, maxTurns: 1 });
	b.onEvent({ type: "turn_start" });
	b.onEvent(reply("stop", 5000, 5000));
	expect(b.report().stopped).toBeUndefined();
});

test("max seconds aborts the signal", async () => {
	const b = createBudget({ ...LIMITS, maxSeconds: 0.05 });
	await new Promise((r) => b.signal.addEventListener("abort", r));
	expect(b.report().stopped).toBe("maxSeconds");
});
