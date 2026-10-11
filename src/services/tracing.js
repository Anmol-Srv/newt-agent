// Turns the agent loop's events into a Langfuse trace tree:
//   agent "newt-run"
//     span "turn N"
//       generation "llm"   → model, what it saw, what it said, tokens, cost
//       tool "<name>"      → args in, result out
// Langfuse itself is started at boot (see langfuse.js / index.js); this file only creates observations.
import { startObservation } from "@langfuse/tracing";
import { tracingEnabled } from "./langfuse.js";

const textOf = (content) =>
	typeof content === "string" ? content : content.filter((p) => p.type === "text").map((p) => p.text).join("");

// Returns an event handler for one run. `context` is the loop's live context, used to record what the model saw.
// `budget` (optional) is attached to the run when it ends: limits, usage, and which limit stopped it.
export function traceRun({ model, context, budget }) {
	if (!tracingEnabled()) return () => {};

	let run, turn, generation;
	let turnNumber = 0;
	const tools = new Map(); // toolCallId → tool observation

	// The loop works on its own copy of `context`, so rebuild the transcript from events to know what each model call was sent.
	const transcript = [...context.messages];
	let firstChunkAt; // when the first streamed chunk of the current reply arrived

	return (event) => {
		switch (event.type) {
			case "agent_start":
				run = startObservation("newt-run", { metadata: { model: `${model.provider}/${model.id}` } }, { asType: "agent" });
				return;

			case "turn_start":
				turn = run.startObservation(`turn ${++turnNumber}`, {}, { asType: "span" });
				return;

			case "message_start": {
				const m = event.message;
				if (m.role === "user" && turnNumber === 1) run.update({ input: textOf(m.content) });
				if (m.role !== "assistant") return;
				// Fires as the request starts. input = everything recorded so far = what the model was sent.
				generation = turn.startObservation("llm", { model: model.id, input: transcript.slice() }, { asType: "generation" });
				firstChunkAt = undefined;
				return;
			}

			case "message_update":
				firstChunkAt ??= new Date(); // first streamed chunk → time-to-first-token
				return;

			case "message_end": {
				const m = event.message;
				transcript.push(m);
				if (m.role !== "assistant" || !generation) return;
				const failed = m.stopReason === "error" || m.stopReason === "aborted";
				generation
					.update({
						output: m.content,
						usageDetails: { input: m.usage.input, output: m.usage.output, cache_read: m.usage.cacheRead },
						costDetails: { input: m.usage.cost.input, output: m.usage.cost.output, total: m.usage.cost.total },
						completionStartTime: firstChunkAt,
						metadata: { stopReason: m.stopReason },
						...(failed && { level: "ERROR", statusMessage: m.errorMessage }),
					})
					.end();
				generation = undefined;
				if (m.stopReason !== "toolUse") run.update({ output: textOf(m.content) });
				return;
			}

			case "tool_execution_start":
				tools.set(event.toolCallId, turn.startObservation(event.toolName, { input: event.args }, { asType: "tool" }));
				return;

			case "tool_execution_end": {
				const tool = tools.get(event.toolCallId);
				tools.delete(event.toolCallId);
				tool
					?.update({
						output: textOf(event.result.content),
						...(event.isError && { level: "ERROR", statusMessage: textOf(event.result.content) }),
					})
					.end();
				return;
			}

			case "turn_end":
				turn?.end();
				return;

			case "agent_end": {
				const report = budget?.report();
				run?.update({
					metadata: { budget: report },
					...(report?.stopped && { level: "WARNING", statusMessage: `Stopped by budget: ${report.stopped}` }),
				}).end();
				return;
			}
		}
	};
}
