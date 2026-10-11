import { Type } from "@earendil-works/pi-ai";

export const getTime = {
	name: "get_time",
	label: "Get time",
	description: "Get the current date and time in an IANA timezone, e.g. Asia/Kolkata or America/New_York.",
	parameters: Type.Object({
		timezone: Type.String({ description: "IANA timezone name, e.g. Asia/Tokyo" }),
	}),
	async execute(toolCallId, { timezone }) {
		// Throws RangeError for an unknown timezone; the loop turns a thrown error into an error result the model can see.
		const time = new Date().toLocaleString("en-GB", { timeZone: timezone, dateStyle: "full", timeStyle: "long" });
		return {
			content: [{ type: "text", text: `${timezone}: ${time}` }],
			details: { timezone, time },
		};
	},
};
