import home from "../../index.html";
import { chat, listModels } from "../services/pi.js";

// Controllers

async function getModels() {
	return Response.json(await listModels());
}

async function postChat(req) {
	const { model, message } = await req.json().catch(() => ({}));
	if (typeof model !== "string" || typeof message !== "string" || !message.trim()) {
		return Response.json({ error: "model and message are required" }, { status: 400 });
	}
	try {
		return Response.json(await chat(model, message)); // { reply, budget }
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
