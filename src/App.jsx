import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
	const [models, setModels] = useState([]);
	const [model, setModel] = useState("");
	const [message, setMessage] = useState("");
	const [items, setItems] = useState([]); // {id, model, prompt, reply?, error?, pending?}
	const [notice, setNotice] = useState("");
	const [loading, setLoading] = useState(false);
	const inputRef = useRef(null);
	const endRef = useRef(null);

	useEffect(() => {
		fetch("/api/models")
			.then((res) => res.json())
			.then((list) => {
				setModels(list);
				setModel(list[0] ?? "");
				if (!list.length) setNotice("No models available. Run `pi` and /login first.");
			})
			.catch((err) => setNotice(`Error: ${err.message}`));
	}, []);

	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [items]);

	const modelValid = models.includes(model);
	const canSend = modelValid && !loading && message.trim() !== "";

	async function send(e) {
		e?.preventDefault();
		if (!canSend) return;
		const id = Date.now() + Math.random();
		const prompt = message;
		setMessage("");
		setLoading(true);
		setItems((xs) => [...xs, { id, model, prompt, pending: true }]);
		const finish = (patch) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, pending: false, ...patch } : x)));
		try {
			const res = await fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model, message: prompt }),
			});
			const data = await res.json();
			finish(data.error || !res.ok ? { error: data.error ?? `HTTP ${res.status}` } : { reply: data.reply, stopped: data.budget?.stopped });
		} catch (err) {
			finish({ error: err.message });
		} finally {
			setLoading(false);
			inputRef.current?.focus();
		}
	}

	function onKeyDown(e) {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			send();
		}
	}

	return (
		<div className="app">
			<header>
				<h1>Newt</h1>
				<div className="picker">
					<label htmlFor="model">Model</label>
					<input
						id="model"
						list="models"
						value={model}
						onChange={(e) => setModel(e.target.value)}
						onFocus={(e) => e.target.select()}
						placeholder="Filter models…"
						autoComplete="off"
						spellCheck="false"
						aria-invalid={model !== "" && !modelValid}
					/>
					<datalist id="models">
						{models.map((m) => (
							<option key={m} value={m} />
						))}
					</datalist>
				</div>
			</header>
			{model !== "" && !modelValid && <p className="hint warn" role="status">Pick a model from the list to send.</p>}

			<main className="messages" aria-live="polite" aria-label="Conversation">
				{notice && <div className="msg error">{notice}</div>}
				{!items.length && !notice && <p className="empty">Ask Newt something.</p>}
				{items.map((x) => (
					<section className="exchange" key={x.id}>
						<div className="msg user">{x.prompt}</div>
						{x.pending ? (
							<div className="msg bot pending">Thinking…</div>
						) : x.error ? (
							<div className="msg error" role="alert"><strong>Error:</strong> {x.error}</div>
						) : (
							<div className="msg bot">
								{x.reply || (x.stopped && "(no answer)")}
								{x.stopped && <div className="stopped">Stopped: budget limit {x.stopped} reached.</div>}
							</div>
						)}
						<div className="meta">{x.model}</div>
					</section>
				))}
				<div ref={endRef} />
			</main>

			<form onSubmit={send}>
				<div className="row">
					<label htmlFor="msg" className="sr">Message</label>
					<textarea
						id="msg"
						ref={inputRef}
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder="Message Newt…"
						rows={2}
						autoFocus
					/>
					<button type="submit" disabled={!canSend}>{loading ? "Thinking…" : "Send"}</button>
				</div>
				<p className="hint">Each message is answered independently. Enter to send, Shift+Enter for a new line.</p>
			</form>
		</div>
	);
}

// Keep the root across hot reloads
const root = (import.meta.hot.data.root ??= createRoot(document.getElementById("root")));
root.render(<App />);
