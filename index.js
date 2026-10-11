import { routes } from "./src/routes/index.js";
import { initLangfuse, shutdownLangfuse } from "./src/services/langfuse.js";

// Boot services before accepting requests, so every agent run is traced.
initLangfuse();

const server = Bun.serve({
	port: process.env.PORT || 3001,
	routes,
});

console.log(`Server is running on ${server.url}`);

// Flush buffered traces before exit. Registered once: `bun --hot` re-runs this file on every save.
if (!globalThis.__newtShutdownHooked) {
	globalThis.__newtShutdownHooked = true;
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, async () => {
			await shutdownLangfuse();
			process.exit(0);
		});
	}
}
