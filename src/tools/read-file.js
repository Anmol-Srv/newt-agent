// Pi's built-in `read` tool (line offset/limit, output truncation, images), confined to the workspace.
// Pi's own version reads ANY path (~/.ssh, our .env…) because Pi expects to run inside a container.
// ponytail: path check only. Real isolation is the sandbox (task 3.1).
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createReadTool } from "@earendil-works/pi-coding-agent";

await mkdir(process.env.NEWT_WORKSPACE || "workspace", { recursive: true });
export const WORKSPACE = await realpath(process.env.NEWT_WORKSPACE || "workspace");

const piRead = createReadTool(WORKSPACE);

export const readFile = {
	...piRead,
	description: `${piRead.description} Only files inside the workspace can be read; use paths relative to it.`,
	async execute(toolCallId, params, signal, onUpdate) {
		// Resolve ourselves and hand Pi an absolute path, so Pi's own ~ and @ expansion can't step outside.
		const target = path.resolve(WORKSPACE, params.path);
		const real = await realpath(target).catch(() => target); // follows symlinks; a missing file keeps its path and Pi reports "not found"
		if (real !== WORKSPACE && !real.startsWith(WORKSPACE + path.sep)) {
			throw new Error(`Access denied: "${params.path}" is outside the workspace`);
		}
		return piRead.execute(toolCallId, { ...params, path: real }, signal, onUpdate);
	},
};
