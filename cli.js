// newt CLI. Reads the event log only: no model calls.
//   bun run newt runs          → recent runs
//   bun run newt show <run>    → replay a run's stored events through the same printer the server uses
import { recentRuns, runWithSteps, sql } from "./src/services/db.js";
import { logEvent } from "./src/services/print.js";

const [command, arg] = process.argv.slice(2);

if (command === "runs") {
	for (const r of await recentRuns()) {
		const status = r.stopped ? `stopped:${r.stopped}` : r.ended ? "ended" : "incomplete";
		console.log(`${r.id}  ${r.created_at.toISOString()}  ${status.padEnd(18)} ${r.model}  "${r.title.slice(0, 50)}"`);
	}
} else if (command === "show" && arg) {
	const found = await runWithSteps(arg).catch(() => undefined); // a malformed uuid is just "not found"
	if (!found) {
		console.error(`No run ${arg}`);
		process.exitCode = 1;
	} else {
		console.log(`run ${found.run.id}  goal ${found.run.goal_id}  ${found.run.model}  "${found.run.title}"\n`);
		for (const event of found.events) logEvent(event);
	}
} else {
	console.log("usage: newt runs | newt show <run-id>");
}
await sql.close();
