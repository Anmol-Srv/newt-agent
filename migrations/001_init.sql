-- Append-only event log. A goal is one conversation; each message the user sends starts a run;
-- every loop event of a run is one step. Rows are only ever inserted, never updated:
-- everything else (status, transcript, cost) is derived from the steps.

create table goals (
	id uuid primary key default gen_random_uuid(),
	title text not null, -- first message, for listing
	created_at timestamptz not null default now()
);

create table runs (
	id uuid primary key default gen_random_uuid(),
	goal_id uuid not null references goals(id),
	model text not null,
	created_at timestamptz not null default now()
);
create index on runs (goal_id, created_at);

create table steps (
	run_id uuid not null references runs(id),
	seq int not null, -- event order within the run
	type text not null, -- loop event type (turn_start, message_end, ...) or "budget"
	data jsonb not null, -- the event as the loop emitted it
	created_at timestamptz not null default now(),
	primary key (run_id, seq)
);
