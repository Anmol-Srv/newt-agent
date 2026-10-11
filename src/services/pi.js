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
export async function chat(modelKey, text, { goalId, limits = DEFAULT_LIMITS } = {}) {
	const model = models.getModels().find((m) => keyOf(m) === "openrouter/nvidia/nemotron-3.5-lightning:free");
	// const model = models.getModels().find((m) => keyOf(m) === modelKey);
	if (!model) throw new Error(`Unknown model: ${modelKey}`);
	if (!API_KEYS[model.provider]) throw new Error(`No API key for ${model.provider}. Set it in .env`);

	if (goalId && !(await goalExists(goalId))) throw new Error(`Unknown goal: ${goalId}`);
	// The conversation so far comes from the event log. Failed/aborted replies are left out: providers reject them.
	const history = goalId ? (await goalMessages(goalId)).filter((m) => !(m.role === "assistant" && ["error", "aborted"].includes(m.stopReason))) : [];
	goalId ??= await createGoal(text);
	const runId = await createRun(goalId, keyOf(model));

	const context = {
		messages: [{ role: "system", content: SYSTEM_PROMPT, timestamp: Date.now() }, ...history],
		tools, // what the loop can execute; it declares them to the model by itself
	};

	const prompt = { role: "user", content: text, timestamp: Date.now() };

	const budget = createBudget(limits);
	const config = {
		model,
		// What the model actually sees each turn. Here: pass system/user/assistant/toolResult through unchanged.
		convertToLlm: (messages) => messages.filter((m) => ["system", "user", "assistant", "toolResult"].includes(m.role)),
		getApiKey: (provider) => API_KEYS[provider],
		beforeToolCall: () => budget.beforeToolCall(),
	};

	// Every step of the loop is reported here. Unused for now; this is where streaming (0.2) and tracing (0.3) plug in.
	// const onEvent = (event) => {
	// 	console.log(event);
	// };
	// Each event goes to the terminal log and to Langfuse.
	// Budget first: it must see a reply's usage before the loop asks beforeToolCall about that reply's tools.
	const trace = traceRun({ model, context, budget });
	// Each event is written to Postgres before the loop moves on (the loop awaits onEvent).
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
		newMessages = await runAgentLoop([prompt], context, config, onEvent, budget.signal, models.streamSimple.bind(models));
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
}