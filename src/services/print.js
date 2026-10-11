// Prints loop events as one readable line each. Used live (pi.js) and to replay a stored run (cli.js).
// Streaming chunks (message_update) are skipped.
const short = (s, n = 120) => {
	const flat = s.replace(/\s+/g, " ");
	return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};
const textOf = (content) => (typeof content === "string" ? content : content.filter((p) => p.type === "text").map((p) => p.text).join(""));
let turn = 0;

export function logEvent(event) {
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
			return console.log(`■ run ended after ${turn} turn(s)`);
		case "budget": // our own step, written after the loop returns
			return console.log(event.stopped ? `  budget: stopped by ${event.stopped}` : "  budget: within limits", event.used, "\n");
	}
}
