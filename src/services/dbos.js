// DBOS as a boot-time service, like Langfuse: index.js launches it before serving and shuts it down on exit.
// DBOS checkpoints workflows and their steps in Postgres (schema "dbos" in the Newt database).
// launch() also resumes every workflow that was cut off (crash, kill -9, reboot) from its last finished step.
import { DBOS } from "@dbos-inc/dbos-sdk";

export async function initDbos() {
	if (globalThis.__newtDbos) return; // `bun --hot` re-runs modules; launch once per process
	globalThis.__newtDbos = true;
	DBOS.setConfig({
		name: "newt",
		systemDatabaseUrl: process.env.DATABASE_URL,
		// DBOS only resumes workflows started by the same code version, and by default derives it from the code.
		// ponytail: pinned, so a restart after an edit still resumes cut-off runs. Bump it when a change
		// alters the order of steps in a run, or old runs will replay against the wrong steps.
		applicationVersion: "1",
		logLevel: "warn",
		tracingEnabled: false, // runs are traced in Langfuse already (tracing.js)
	});
	await DBOS.launch();
	console.log("DBOS: launched (cut-off runs resume now)");
}

export async function shutdownDbos() {
	if (globalThis.__newtDbos) await DBOS.shutdown();
}
