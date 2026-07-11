# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

**FarmAgent** — a conversational agent for farmers that answers questions and takes
actions using real farm data: weather, crop/soil info, and pest/disease detection
from photos. Built as a focused, end-to-end demo (agent + trained model + web app),
not a full product — scope discipline matters more than feature count.

Target shape: one agent core that orchestrates tools, one of those tools backed by
an actually-trained model (not just an API call), a web dashboard, and a
mobile-friendly PWA rather than a separate native app. Where possible, tool
outputs should culminate in a concrete, actionable number or recommendation
(e.g. a confidence-scored diagnosis with a suggested treatment window, not just
a label) rather than a bare classification — this is what separates a decision-
support tool from a demo classifier, and it's the bar comparable projects in this
space have set.

## Current milestone

Complete: train and evaluate the first real classifier. The leakage-safe manifest
contains 2,703 train, 569 validation, and 580 test images with no leaf IDs crossing
partitions. `model/train.py` fine-tunes ImageNet-pretrained MobileNetV3 Small with
class-weighted loss, train-only augmentation, per-epoch validation, and automatic
lowest-validation-loss checkpointing. The seed-42 eight-epoch MPS run selected
epoch 6 and achieved 98.28% test accuracy and 97.68% macro F1. `model/eval.py`
independently reproduced the same loss, metrics, and confusion matrix from the
saved checkpoint. Eight Python tests and eight agent tests pass. Metrics are
PlantVillage-only and must not be presented as field-photo performance. Next:
build a small FastAPI inference service around the saved artifact, then expose it
as `diagnose_crop_image`; neither serving layer is implemented yet.

The bounded Anthropic tool-use loop and JSON-backed corn lookup remain complete.
`npm run build` and `npm test` pass with eight behavioral tests using a fake
client, not a live API key. The weather tool is not implemented yet.

Update this section as work progresses — keep it accurate, it's the fastest way
for a new session to know where things stand.

- [ ] Scaffold repo structure
- [ ] Agent core with tool-use loop (weather tool, crop/soil lookup tool)
- [ ] Pest/disease image classifier (PlantVillage or similar), trained + evaluated
- [ ] Classifier output includes a concrete recommendation (confidence + suggested
      action/window), not just a bare class label
- [ ] Wire classifier into agent as a callable tool
- [ ] Web dashboard (chat interface + results view)
- [ ] PWA polish (responsive, installable, offline-friendly where reasonable) —
      treat mobile usability as a real requirement, not an afterthought pass
- [ ] README + demo script/recording

## Tech stack

- **Agent core**: TypeScript, Anthropic API (tool use / function calling)
- **Model training**: Python, PyTorch, PlantVillage (or similar open dataset) for
  the disease/pest classifier
- **Web app**: Next.js, deployed as a PWA (skip native mobile — see scope note below)
- **Data/tools**: weather via a free API (e.g. Open-Meteo), crop/soil data can start
  as a small static/JSON dataset before anything fancier

## Repo structure

```
/agent          - agent orchestration, tool definitions, system prompts
/model           - training scripts, dataset prep, saved weights, eval notebook/script
/model/serve     - small inference service the agent calls (FastAPI or similar)
/web             - Next.js app (chat UI, dashboard, PWA manifest)
/docs            - README, architecture notes, demo script
```

Adjust this if the actual layout diverges — keep this file in sync with reality,
don't let it go stale.

## Architecture notes

- The agent is the orchestrator. It should reason step-by-step and call tools
  explicitly (weather, crop lookup, disease classifier) rather than trying to
  answer from parametric knowledge alone — the whole point of this project is to
  demonstrate multi-step tool use, not a single prompt-response wrapper.
- The disease classifier is a separate trained artifact, served behind a small
  inference endpoint, and exposed to the agent as one tool among several. Don't
  fold model inference logic into the agent code itself — keep the boundary clean
  so each piece is independently demoable.
- The classifier's tool response should be structured to include confidence and
  a suggested next step (e.g. "treat within N days," "capture another photo,"
  "low confidence — recommend agronomist follow-up"), and the agent should
  reason over that structure in its reply rather than just relaying a label.
- Keep the web app thin: it renders the conversation and structured results
  (weather cards, diagnosis + confidence, recommendations). Business logic lives
  in the agent, not the frontend.

## Scope guardrails

This project needs to actually ship. Default to the smallest version of each
component that still proves the concept:

- One crop, one region is fine for the initial demo.
- The classifier doesn't need SOTA accuracy — it needs a real train/eval loop and
  honest reported metrics.
- PWA, not native iOS/Android, unless there's time left over at the end — but the
  PWA should feel genuinely usable on a phone (touch targets, layout, load time),
  not just responsive CSS on a desktop design.
- If a feature isn't needed to demonstrate "agent using tools including a trained
  model, producing an actionable recommendation, in a usable app," cut it or
  defer it.

When in doubt, ask before expanding scope rather than building ahead of what's asked.

## Working conventions

- Commit in small, working increments. Don't let the tree sit broken across a
  session boundary.
- Before marking any milestone checkbox done, actually run the thing (train step
  completes and prints metrics, agent tool call round-trips, web page renders)
  — don't mark done on code that "should work."
- Prefer explicit, readable code over cleverness; this repo is a portfolio piece
  that may get read line-by-line by an interviewer.
- Python: type hints, small functions, docstrings on training/eval entry points.
- TypeScript: strict mode on, avoid `any`.

## AI-assisted development and verification

AI may write the implementation, but the developer remains responsible for the
problem definition, architecture, correctness, and technical tradeoffs. For each
bounded increment, follow this workflow:

1. State the user-visible behavior and constraints before implementation.
2. Define observable acceptance criteria, including at least one success case
   and one failure or edge case.
3. Explain the proposed data flow, module boundary, assumptions, and major
   failure modes before editing code.
4. Implement only the smallest increment that satisfies those criteria.
5. Verify at the appropriate layers: compiler/type checks, focused unit tests,
   integration tests against real boundaries where practical, and manual UI or
   output inspection when behavior is visual or data-dependent.
6. Do not let mocks stand in as proof that a real API, dataset, model artifact,
   browser, or service integration works. Clearly distinguish mocked evidence
   from real integration evidence.
7. Exercise malformed inputs, dependency failures, and boundary conditions where
   they are relevant. Pay particular attention to API contracts, model-generated
   inputs, file handling, data splitting, authentication, and external services.
8. Report what was actually run, what remains unverified, and any assumptions or
   residual risks. Never describe code that merely "should work" as complete.
9. After substantial increments, explain the result at three levels: the
   component's purpose, its data flow, and its failure behavior. Name the source
   files involved and use a concrete example when useful.
10. Maintain `docs/ENGINEERING_DECISIONS.md` as an interview-oriented record of
    meaningful problems encountered during real implementation. For each entry,
    document the intended behavior, observed symptom, investigation, root cause,
    decision or fix, verification evidence, remaining limitations, and a concise
    interview-ready explanation. Record substantive architectural, integration,
    data-quality, security, and debugging lessons; omit routine syntax mistakes
    and low-value setup noise.
11. Treat `docs/ENGINEERING_PLAYBOOK.md` as the reusable collaboration and learning
    standard for this repository. Keep project-specific instructions in this file
    and general engineering habits in the playbook.

The developer does not need to memorize generated syntax, but should be able to
read the important paths, trace a representative request or data sample through
the system, explain why each boundary exists, and defend the verification
strategy in an interview. When introducing an unfamiliar or important concept,
pause after the explanation and use a small number of targeted comprehension
questions before building further. Do not move to the next substantial increment
until the developer can explain the current increment's purpose, data flow,
boundaries, major decisions, and failure behavior in their own words. Treat this
as a learning checkpoint rather than a memorization test: revisit earlier
components, use concrete examples, and repeat the framework as needed until the
reasoning is clear. Prioritize architectural understanding over recalling syntax.

## Commands

Fill these in as they're established.

```
# model
pip install -r model/requirements.txt
python model/inspect_dataset.py
python model/prepare_splits.py
python -m unittest discover -s model -p 'test_*.py'
python model/train.py --epochs 8 --batch-size 32
python model/eval.py --batch-size 32

# agent / web
npm install
npm run build
npm test
```

## Notes for Claude

- This is a from-scratch project being built quickly against a deadline. Bias
  toward getting something runnable early, then iterating, over designing the
  "correct" architecture upfront.
- If a decision meaningfully changes scope (adding native mobile, swapping the
  dataset, adding a second model), flag it explicitly rather than just doing it.
- Ask before assuming API keys, credentials, or paid services — default to free
  tiers / open datasets unless told otherwise.
- When designing tool outputs (especially the classifier), favor structures that
  let the agent produce a concrete, defensible recommendation over a bare label
  — this is a deliberate product/portfolio choice, not just a modeling detail.
