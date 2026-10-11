// Budgets are enforced by the runtime, not requested in the prompt. Four limits per run:
//   turns, tokens, seconds → always meaningful;  cost → only for paid models (free ones report $0).
// Two ways a run gets stopped:
//   1. turns/tokens/cost: checked when the model finishes a reply. If it's over budget and still wants tools,
//      beforeToolCall blocks those tools (no side effects past the limit) and the loop ends after that batch.
//   2. seconds: a timer aborts the run's AbortSignal, which cancels the model stream or the running tool.

// ponytail: one fixed default for every run. Per-goal budgets come with goals in Phase 1.
export const DEFAULT_LIMITS = { maxTurns: 8, maxTokens: 100_000, maxSeconds: 120, maxCost: 0.1 };

export function createBudget(limits = DEFAULT_LIMITS) {
	const controller = new AbortController();
	const startedAt = Date.now();
	const used = { turns: 0, tokens: 0, cost: 0 };
	let hit; // name of the first limit crossed, e.g. "maxTurns"

	const timer = setTimeout(() => {
		hit ??= "maxSeconds";
		controller.abort();
	}, limits.maxSeconds * 1000);

	const over = () =>
		(used.turns >= limits.maxTurns && "maxTurns") ||
		(used.tokens >= limits.maxTokens && "maxTokens") ||
		(used.cost >= limits.maxCost && "maxCost") ||
		undefined;

	return {
		signal: controller.signal,

		// Feed every loop event through here.
		onEvent(event) {
			if (event.type === "turn_start") used.turns++;
			if (event.type !== "message_end" || event.message.role !== "assistant") return;
			const { usage, stopReason } = event.message;
			used.tokens += usage.input + usage.output;
			used.cost += usage.cost.total;
			// Only a reply that asks for more work can be stopped. A final answer is let through even if it crossed a limit.
			if (stopReason === "toolUse") hit ??= over();
		},

		// AgentLoopConfig.beforeToolCall: refuse tools once the budget is spent. terminate → loop ends after this batch.
		async beforeToolCall() {
			if (hit) return { block: true, reason: `Budget exhausted (${hit}). Tool not run.`, terminate: true };
		},

		// Limits, usage, and which limit stopped the run (if any). Stops the timer; safe to call more than once.
		report() {
			clearTimeout(timer);
			return { stopped: hit, limits, used: { ...used, seconds: (Date.now() - startedAt) / 1000 } };
		},
	};
}
