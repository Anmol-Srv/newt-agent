import home from "../../index.html";
import { chat, listModels } from "../services/pi.js";

// Controllers

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getModels() {
	return Response.json(await listModels());
}

async function postChat(req) {
	const { model, message, goalId } = await req.json().catch(() => ({}));
	if (typeof model !== "string" || typeof message !== "string" || !message.trim()) {
		return Response.json({ error: "model and message are required" }, { status: 400 });
	}
	if (goalId !== undefined && !UUID.test(goalId)) {
		return Response.json({ error: "goalId must be a uuid" }, { status: 400 });
	}
	try {
		return Response.json(await chat(model, message, { goalId })); // { reply, budget, goalId, runId }
	} catch (err) {
		return Response.json({ error: err.message }, { status: 500 });
	}
}

// Routes

export const routes = {
	"/": home,
	"/api/models": { GET: getModels },
	"/api/chat": { POST: postChat },
};
