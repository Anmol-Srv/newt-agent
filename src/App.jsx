import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
	const [models, setModels] = useState([]);
	const [model, setModel] = useState("");
	const [message, setMessage] = useState("");
	const [reply, setReply] = useState("");
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		fetch("/api/models")
			.then((res) => res.json())
			.then((list) => {
				setModels(list);
				setModel(list[0] ?? "");
				if (!list.length) setReply("No models available. Run `pi` and /login first.");
			})
			.catch((err) => setReply(`Error: ${err.message}`));
	}, []);

	async function send(e) {
		e.preventDefault();
		setLoading(true);
		setReply("Thinking…");
		try {
			const res = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model, message }),
			});
			const data = await res.json();
			setReply(data.error ? `Error: ${data.error}` : data.reply);
		} catch (err) {
			setReply(`Error: ${err.message}`);
		} finally {
			setLoading(false);
		}
	}

	return (
		<main>
			<label>
				Model{" "}
				<select value={model} onChange={(e) => setModel(e.target.value)}>
					{models.map((m) => (
						<option key={m} value={m}>{m}</option>
					))}
				</select>
			</label>
			<form onSubmit={send}>
				<input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Say something" autoComplete="off" required />
				<button disabled={loading || !model}>Send</button>
			</form>
			<div className="reply">{reply}</div>
		</main>
	);
}

createRoot(document.getElementById("root")).render(<App />);
