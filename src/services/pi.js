// Newt talks to Pi's two lower layers only:
//   pi-ai          → models, providers, streaming (one API over every LLM provider)
//   pi-agent-core  → the agent loop (model call → tool calls → results → repeat)
// No pi-coding-agent: no ~/.pi settings, no auth.json, no AGENTS.md/skills/extensions discovery,
// no JSONL sessions. Everything the loop needs is passed in explicitly below.
import { runAgentLoop } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { tools } from "../tools/index.js";
import { traceRun } from "./tracing.js";
import { createBudget, DEFAULT_LIMITS } from "./budget.js";
import { logEvent } from "./print.js";
import { appendStep, createGoal, createRun, goalExists, goalMessages } from "./db.js";
import { durableStream, durableTools, step } from "./steps.js";
import { DBOS } from "@dbos-inc/dbos-sdk";

const SYSTEM_PROMPT = "You are Newt, a helpful assistant.";

// ponytail: OpenRouter is the only provider registered, because it's the only key we have.
// Add another provider = one more setProvider() line and one more env var.
const models = createModels();
models.setProvider(openrouterProvider());

// The key comes from the environment (Bun loads .env), never from ~/.pi.
const API_KEYS = { openrouter: process.env.OPENROUTER_API_KEY };

const keyOf = (model) => `${model.provider}/${model.id}`;

export async function listModels() {
	return models.getModels("openrouter").map(keyOf);
}

// goalId: continue that conversation; omitted → start a new goal.
// Prepares the run, then hands it to the durable workflow below and waits for its answer.
export async function chat(modelKey, text, { goalId, limits = DEFAULT_LIMITS } = {}) {
	const model = models.getModels().find((m) => keyOf(m) === "openrouter/nvidia/nemotron-3.5-lightning:free");
	// const model = models.getModels().find((m) => keyOf(m) === modelKey);
	if (!model) throw new Error(`Unknown model: ${modelKey}`);
	if (!API_KEYS[model.provider]) throw new Error(`No API key for ${model.provider}. Set it in .env`);

	if (goalId && !(await goalExists(goalId))) throw new Error(`Unknown goal: ${goalId}`);
	goalId ??= await createGoal(text);
	const runId = await createRun(goalId, keyOf(model));

	// Workflow ID = run ID: one durable workflow per run. Its input must be plain JSON: DBOS saves it for a resume.
	const handle = await DBOS.startWorkflow(agentRun, { workflowID: runId })({ runId, goalId, modelKey: keyOf(model), text, limits });
	return handle.getResult();
}

// One run of the agent loop, as a DBOS workflow. If the process dies mid-run, DBOS.launch() at the next boot
// calls this again with the same input; finished steps (history, model calls, tool calls) return their saved
// results, so the run carries on from where it stopped. Everything outside a step must therefore be
// deterministic: same steps, same order, every time. (Tools run one at a time for that reason.)
// ponytail: `bun --hot` keeps the first registered version; restart the server after editing this function.
const agentRun = (globalThis.__newtAgentRun ??= DBOS.registerWorkflow(
	async ({ runId, goalId, modelKey, text, limits }) => {
		const model = models.getModels().find((m) => keyOf(m) === modelKey);

		// The conversation so far comes from the event log. Failed/aborted replies are left out: providers reject them.
		const history = await step("history", async () =>
			(await goalMessages(goalId)).filter((m) => !(m.role === "assistant" && ["error", "aborted"].includes(m.stopReason))),
		);

		const context = {
			messages: [{ role: "system", content: SYSTEM_PROMPT, timestamp: Date.now() }, ...history],
			tools: durableTools(tools), // what the loop can execute; it declares them to the model by itself
		};

		const prompt = { role: "user", content: text, timestamp: Date.now() };

		// ponytail: on a resume the budget starts over (turns/tokens are recounted from replayed steps, seconds restart).
		const budget = createBudget(limits);
		const config = {
			model,
			// What the model actually sees each turn. Here: pass system/user/assistant/toolResult through unchanged.
			convertToLlm: (messages) => messages.filter((m) => ["system", "user", "assistant", "toolResult"].includes(m.role)),
			getApiKey: (provider) => API_KEYS[provider],
			beforeToolCall: () => budget.beforeToolCall(),
			toolExecution: "sequential", // parallel tools could start their steps in a different order on a replay
		};

		// Each event goes to the terminal log, to Langfuse and to the event log in Postgres.
		// Budget first: it must see a reply's usage before the loop asks beforeToolCall about that reply's tools.
		// ponytail: a resumed run gets a new Langfuse trace.
		const trace = traceRun({ model, context, budget });
		// Each event is written before the loop moves on (the loop awaits onEvent).
		// A resumed run emits the same events again with the same seq; appendStep skips the ones already stored.
		// ponytail: streaming chunks (message_update) are not stored; message_end has the full message.
		let seq = 0;
		const onEvent = async (event) => {
			budget.onEvent(event);
			logEvent(event);
			trace(event);
			if (event.type !== "message_update") await appendStep(runId, seq++, event);
		};

		// Runs the loop until the model stops. Returns only the messages this run added (user prompt + assistant reply).
		// The budget's signal is how the loop gets cancelled when time runs out.
		let newMessages, report;
		try {
			newMessages = await runAgentLoop([prompt], context, config, onEvent, budget.signal, durableStream(models.streamSimple.bind(models)));
		} finally {
			report = budget.report(); // also stops the timer
		}
		const budgetStep = { type: "budget", ...report };
		logEvent(budgetStep);
		await appendStep(runId, seq++, budgetStep);

		const reply = newMessages.findLast((m) => m.role === "assistant");
		if (!reply) throw new Error("Model returned no reply");
		// An abort caused by the budget is a clean stop, not a failure.
		if (reply.stopReason === "error" || (reply.stopReason === "aborted" && !report.stopped)) {
			throw new Error(reply.errorMessage ?? `Model ${reply.stopReason}`);
		}

		const answer = reply.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("")
			.trim();
		return { reply: answer, budget: report, goalId, runId };
	},
	{ name: "agentRun" },
));
