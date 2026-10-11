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

const SYSTEM_PROMPT = "You are Newt, a helpful assistant.";

// ponytail: OpenRouter is the only provider registered, because it's the only key we have.
// Add another provider = one more setProvider() line and one more env var.
const models = createModels();
models.setProvider(openrouterProvider());

// The key comes from the environment (Bun loads .env), never from ~/.pi.
const API_KEYS = { openrouter: process.env.OPENROUTER_API_KEY };

const keyOf = (model) => `${model.provider}/${model.id}`;

// One readable line per loop step instead of raw event JSON. Streaming chunks (message_update) are skipped.
const short = (s, n = 120) => {
	const flat = s.replace(/\s+/g, " ");
	return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};
const textOf = (content) => (typeof content === "string" ? content : content.filter((p) => p.type === "text").map((p) => p.text).join(""));
let turn = 0;

function logEvent(event) {
	switch (event.type) {
		case "agent_start":
			turn = 0;
			return console.log("▶ run started");
		case "turn_start":
			return console.log(`  turn ${++turn}`);
		case "message_end": {
			const m = event.message;
			if (m.role === "user") return console.log(`    user: ${short(textOf(m.content))}`);
			if (m.role !== "assistant") return;
			const calls = m.content.filter((p) => p.type === "toolCall").length;
			const said = textOf(m.content).trim();
			const usage = m.usage ? ` ${m.usage.input}→${m.usage.output} tokens` : "";
			if (said) console.log(`    model: ${short(said)}`);
			return console.log(`    [${m.stopReason}${calls ? `, ${calls} tool call(s)` : ""}${usage}]${m.errorMessage ? ` ${m.errorMessage}` : ""}`);
		}
		case "tool_execution_start":
			return console.log(`    → ${event.toolName} ${JSON.stringify(event.args)}`);
		case "tool_execution_end":
			return console.log(`    ${event.isError ? "✗" : "←"} ${event.toolName}: ${short(textOf(event.result.content))}`);
		case "agent_end":
			return console.log(`■ run ended after ${turn} turn(s)\n`);
	}
}

export async function listModels() {
	return models.getModels("openrouter").map(keyOf);
}

export async function chat(modelKey, text, limits = DEFAULT_LIMITS) {
	const model = models.getModels().find((m) => keyOf(m) === "openrouter/nvidia/nemotron-3.5-lightning:free");
	// const model = models.getModels().find((m) => keyOf(m) === modelKey);
	if (!model) throw new Error(`Unknown model: ${modelKey}`);
	if (!API_KEYS[model.provider]) throw new Error(`No API key for ${model.provider}. Set it in .env`);

	// The whole conversation state. ponytail: one message, no history. Becomes the Postgres event log in task 1.1.
	const context = {
		messages: [{ role: "system", content: SYSTEM_PROMPT, timestamp: Date.now() }],
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
	const onEvent = (event) => {
		budget.onEvent(event);
		logEvent(event);
		trace(event);
	};

	// Runs the loop until the model stops. Returns only the messages this run added (user prompt + assistant reply).
	// The budget's signal is how the loop gets cancelled when time runs out.
	let newMessages, report;
	try {
		newMessages = await runAgentLoop([prompt], context, config, onEvent, budget.signal, models.streamSimple.bind(models));
	} finally {
		report = budget.report(); // also stops the timer
	}
	if (report.stopped) console.log(`  budget: stopped by ${report.stopped}`, report.used);

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
	return { reply: answer, budget: report };
}