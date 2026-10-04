import { routes } from "./src/routes/index.js";

const server = Bun.serve({
	port: process.env.PORT || 3001,
	routes,
});

console.log(`Server is running on ${server.url}`);
