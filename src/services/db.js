// The event log in Postgres (schema: migrations/001_init.sql). Insert-only.
import { SQL } from "bun";

// Explicit URL, no fallback: Bun's default would silently connect to localhost:5432, another project's database here.
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. See .env.example");
export const sql = new SQL(process.env.DATABASE_URL);

export async function createGoal(title) {
	const [goal] = await sql`insert into goals (title) values (${title.slice(0, 200)}) returning id`;
	return goal.id;
}

export async function goalExists(id) {
	const [row] = await sql`select 1 from goals where id = ${id}`;
	return Boolean(row);
}

export async function createRun(goalId, model) {
	const [run] = await sql`insert into runs (goal_id, model) values (${goalId}, ${model}) returning id`;
	return run.id;
}

export async function appendStep(runId, seq, event) {
	await sql`insert into steps (run_id, seq, type, data) values (${runId}, ${seq}, ${event.type}, ${event}::jsonb)`;
}

// Every message of every earlier run in this goal, in order: the conversation so far.
// System messages are skipped: the loop adds its own each run (the system prompt, the tool list).
export async function goalMessages(goalId) {
	const rows = await sql`
		select s.data->'message' as message
		from steps s join runs r on r.id = s.run_id
		where r.goal_id = ${goalId} and s.type = 'message_end' and s.data->'message'->>'role' <> 'system'
		order by r.created_at, s.seq`;
	return rows.map((r) => r.message);
}

export async function runWithSteps(runId) {
	const [run] = await sql`select r.*, g.title from runs r join goals g on g.id = r.goal_id where r.id = ${runId}`;
	if (!run) return undefined;
	const steps = await sql`select type, data from steps where run_id = ${runId} order by seq`;
	return { run, events: steps.map((s) => s.data) };
}

export async function recentRuns(limit = 20) {
	return sql`
		select r.id, r.model, r.created_at, g.title,
			(select data->>'stopped' from steps where run_id = r.id and type = 'budget') as stopped,
			exists (select 1 from steps where run_id = r.id and type = 'agent_end') as ended
		from runs r join goals g on g.id = r.goal_id
		order by r.created_at desc limit ${limit}`;
}
