// Langfuse as a boot-time service: index.js starts it before serving and shuts it down on exit.
// Spans are standard OpenTelemetry; LangfuseSpanProcessor batches them and ships them to LANGFUSE_BASE_URL.
// Moving to self-hosted Langfuse later = change the three LANGFUSE_* env vars, no code change.
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

// Kept on globalThis because `bun --hot` re-runs modules on save; a second provider would send every span twice.
export function initLangfuse() {
	if (globalThis.__newtLangfuse) return;
	if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
		console.log("Langfuse: no keys, tracing off");
		return;
	}
	const processor = new LangfuseSpanProcessor();
	new NodeTracerProvider({ spanProcessors: [processor] }).register();
	globalThis.__newtLangfuse = processor;
	console.log(`Langfuse: tracing to ${process.env.LANGFUSE_BASE_URL}`);
}

export const tracingEnabled = () => Boolean(globalThis.__newtLangfuse);

// Spans are sent in batches; flush whatever is still buffered.
export async function shutdownLangfuse() {
	await globalThis.__newtLangfuse?.shutdown();
}
