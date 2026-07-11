CLAUDE.md

Guidance for Claude Code when working in this repository.

Project

FarmAgent — a conversational agent for farmers that answers questions and takes
actions using real farm data: weather, crop/soil info, and pest/disease detection
from photos. Built as a focused, end-to-end demo (agent + trained model + web app),
not a full product — scope discipline matters more than feature count.

Target shape: one agent core that orchestrates tools, one of those tools backed by
an actually-trained model (not just an API call), a web dashboard, and a
mobile-friendly PWA rather than a separate native app.

Current milestone

In progress: build the Anthropic tool-use loop. The agent can send a user message
with tool definitions, receive a response, detect `tool_use` blocks, and validate
their names and inputs against registered Zod schemas. Validated calls can now
be dispatched to the matching tool and executed while preserving the Anthropic
tool-use ID with the output. The loop now returns `tool_result` blocks to
Anthropic, preserves conversation history, and repeats until a final response or
the configured tool-round limit. The JSON-backed corn lookup remains implemented.
`npm run build` and `npm test` pass with eight behavioral tests. The round trip is
verified with a fake client, not a live API key. The weather tool is not
implemented yet.


Update this section as work progresses — keep it accurate, it's the fastest way
for a new session to know where things stand.




 Scaffold repo structure
 Agent core with tool-use loop (weather tool, crop/soil lookup tool)
 Pest/disease image classifier (PlantVillage or similar), trained + evaluated
 Wire classifier into agent as a callable tool
 Web dashboard (chat interface + results view)
 PWA polish (responsive, installable, offline-friendly where reasonable)
 README + demo script/recording


Tech stack


Agent core: TypeScript, Anthropic API (tool use / function calling)
Model training: Python, PyTorch, PlantVillage (or similar open dataset) for
the disease/pest classifier
Web app: Next.js, deployed as a PWA (skip native mobile — see scope note below)
Data/tools: weather via a free API (e.g. Open-Meteo), crop/soil data can start
as a small static/JSON dataset before anything fancier


Repo structure

/agent          - agent orchestration, tool definitions, system prompts
/model           - training scripts, dataset prep, saved weights, eval notebook/script
/model/serve     - small inference service the agent calls (FastAPI or similar)
/web             - Next.js app (chat UI, dashboard, PWA manifest)
/docs            - README, architecture notes, demo script

Adjust this if the actual layout diverges — keep this file in sync with reality,
don't let it go stale.

Architecture notes


The agent is the orchestrator. It should reason step-by-step and call tools
explicitly (weather, crop lookup, disease classifier) rather than trying to
answer from parametric knowledge alone — the whole point of this project is to
demonstrate multi-step tool use, not a single prompt-response wrapper.
The disease classifier is a separate trained artifact, served behind a small
inference endpoint, and exposed to the agent as one tool among several. Don't
fold model inference logic into the agent code itself — keep the boundary clean
so each piece is independently demoable.
Keep the web app thin: it renders the conversation and structured results
(weather cards, diagnosis + confidence, recommendations). Business logic lives
in the agent, not the frontend.


Scope guardrails

This project needs to actually ship. Default to the smallest version of each
component that still proves the concept:


One crop, one region is fine for the initial demo.
The classifier doesn't need SOTA accuracy — it needs a real train/eval loop and
honest reported metrics.
PWA, not native iOS/Android, unless there's time left over at the end.
If a feature isn't needed to demonstrate "agent using tools including a trained
model, in a usable web app," cut it or defer it.


When in doubt, ask before expanding scope rather than building ahead of what's asked.

Working conventions


Commit in small, working increments. Don't let the tree sit broken across a
session boundary.
Before marking any milestone checkbox done, actually run the thing (train step
completes and prints metrics, agent tool call round-trips, web page renders)
— don't mark done on code that "should work."
Prefer explicit, readable code over cleverness; this repo is a portfolio piece
that may get read line-by-line by an interviewer.
Python: type hints, small functions, docstrings on training/eval entry points.
TypeScript: strict mode on, avoid any.


Commands


Fill these in as they're established.



# model
python model/train.py
python model/eval.py

# agent / web
npm install
npm run build
npm test

Notes for Claude


This is a from-scratch project being built quickly against a deadline. Bias
toward getting something runnable early, then iterating, over designing the
"correct" architecture upfront.
If a decision meaningfully changes scope (adding native mobile, swapping the
dataset, adding a second model), flag it explicitly rather than just doing it.
Ask before assuming API keys, credentials, or paid services — default to free
tiers / open datasets unless told otherwise.
