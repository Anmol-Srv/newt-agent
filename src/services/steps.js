// Makes Pi's model calls and tool calls DBOS steps, without changing Pi's loop.
// A step runs once; DBOS saves its result in Postgres. When a cut-off run is resumed, the loop runs again
// from the top, but every step that already finished returns its saved result instead of running again.
// So the model is not asked again and tools don't run again — except the step that was in progress
// when the process died: it has no saved result, so it runs again (at least once, not exactly once: task 1.3).
import { DBOS } from "@dbos-inc/dbos-sdk";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

// Wraps Pi's stream function (one model call). The step returns the final message, which is what gets saved.
// First run: chunks are forwarded live as they stream. Replay: no chunks, just the saved message.
export function durableStream(streamFn) {
	return (model, context, options) => {
		const out = createAssistantMessageEventStream();
		let live = false;
		DBOS.runStep(
			async () => {
				live = true;
				const inner = await streamFn(model, context, options);
				for await (const event of inner) out.push(event);
				return inner.result();
			},
			{ name: "model" },
		).then(
			(message) => {
				if (!live) out.push(finalEvent(message)); // replayed: hand the loop the saved message
				out.end(message);
			},
			(err) => {
				const message = failedMessage(model, err); // checkpointing itself failed (e.g. Postgres down)
				out.push(finalEvent(message));
				out.end(message);
			},
		);
		return out;
	};
}

// Wraps each tool's execute. The tool result ({content, details}) is what gets saved.
export function durableTools(tools) {
	return tools.map((tool) => ({
		...tool,
		execute: (toolCallId, params, signal, onUpdate) =>
			DBOS.runStep(() => tool.execute(toolCallId, params, signal, onUpdate), { name: `tool:${tool.name}` }),
	}));
}

// Any step outside DBOS: e.g. reading the conversation history once, so a replay sees the same history.
export const step = (name, fn) => DBOS.runStep(fn, { name });

const finalEvent = (message) =>
	message.stopReason === "error" || message.stopReason === "aborted"
		? { type: "error", reason: message.stopReason, error: message }
		: { type: "done", reason: message.stopReason, message };

const failedMessage = (model, err) => ({
	role: "assistant",
	content: [],
	api: model.api,
	provider: model.provider,
	model: model.id,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "error",
	errorMessage: `Model step failed: ${err?.message ?? err}`,
	timestamp: Date.now(),
});
