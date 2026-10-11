// GET a public web page. Pi has no built-in web tool.
// The URL comes from the model, so it's untrusted: only public http(s) addresses are allowed,
// so the agent can't reach localhost, the LAN, Tailscale machines or cloud metadata endpoints.
// ponytail: the DNS check and the actual request resolve separately (DNS rebinding can slip through).
// The real fix is an egress proxy that enforces this at the network level (task 4.3).
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Type } from "@earendil-works/pi-ai";

const MAX_CHARS = 20_000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;

function isPrivate(ip) {
	if (net.isIPv6(ip)) {
		const v = ip.toLowerCase();
		if (v.startsWith("::ffff:")) return isPrivate(v.slice(7)); // IPv4-mapped
		return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
	}
	const [a, b] = ip.split(".").map(Number);
	return (
		a === 0 || a === 10 || a === 127 ||
		(a === 169 && b === 254) || // link-local, cloud metadata
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127) // CGNAT, incl. Tailscale 100.x
	);
}

async function assertPublic(url) {
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http(s) URLs are allowed, got ${url.protocol}`);
	const addresses = await lookup(url.hostname, { all: true });
	if (addresses.some(({ address }) => isPrivate(address))) throw new Error(`Blocked: ${url.hostname} is a private or local address`);
}

// ponytail: regex tag stripping to save tokens. Swap for a readability/markdown converter if pages read badly.
const htmlToText = (html) =>
	html
		.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();

export const httpGet = {
	name: "http_get",
	label: "HTTP GET",
	description: `Fetch a public web page or API with an HTTP GET and return its text (HTML is reduced to plain text, max ${MAX_CHARS} characters).`,
	parameters: Type.Object({
		url: Type.String({ description: "Full http(s) URL" }),
	}),
	async execute(toolCallId, { url }, signal) {
		let current = new URL(url);
		const timeout = AbortSignal.timeout(TIMEOUT_MS);
		const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

		// Follow redirects by hand so every hop gets the same public-address check.
		for (let hop = 0; ; hop++) {
			await assertPublic(current);
			const res = await fetch(current, { redirect: "manual", signal: abort, headers: { "user-agent": "newt-agent" } });
			const location = res.headers.get("location");
			if (res.status >= 300 && res.status < 400 && location) {
				if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
				current = new URL(location, current);
				continue;
			}

			const type = res.headers.get("content-type") ?? "";
			const raw = await res.text();
			const body = type.includes("html") ? htmlToText(raw) : raw;
			const truncated = body.length > MAX_CHARS;
			return {
				content: [{ type: "text", text: `HTTP ${res.status} ${current.href}\n\n${body.slice(0, MAX_CHARS)}${truncated ? "\n\n[truncated]" : ""}` }],
				details: { status: res.status, url: current.href, contentType: type, chars: body.length, truncated },
			};
		}
	},
};
