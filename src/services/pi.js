import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

// Reads the same credentials as the pi CLI (~/.pi/agent/auth.json).
const runtime = await ModelRuntime.create();

export async function listModels() {
	const models = await runtime.getAvailable();
	return models.map((model) => `${model.provider}/${model.id}`);
}

export async function chat(modelKey, text) {
	const model = (await runtime.getAvailable()).find((m) => `${m.provider}/${m.id}` === modelKey);
	if (!model) throw new Error(`Unknown or unavailable model: ${modelKey}`);

	const { session } = await createAgentSession({
		model,
		modelRuntime: runtime,
		noTools: "all",
		sessionManager: SessionManager.inMemory(),
	});

	try {
		await session.prompt(text);
		const last = session.messages.at(-1);
		if (last?.role === "assistant" && last.stopReason === "error") throw new Error(last.errorMessage ?? "Model error");
		return session.getLastAssistantText() ?? "";
	} finally {
		session.dispose();
	}
}
