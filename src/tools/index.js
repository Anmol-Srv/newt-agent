// Tools Newt can call. A tool is a contract:
//   name + description  → what the model reads to decide when to call it
//   parameters          → TypeBox schema; the loop validates the model's arguments against it before execute()
//   execute()           → does the work; `content` goes back to the model, `details` stays with us
import { getTime } from "./get-time.js";
import { httpGet } from "./http-get.js";
import { readFile } from "./read-file.js";

export const tools = [getTime, readFile, httpGet];
