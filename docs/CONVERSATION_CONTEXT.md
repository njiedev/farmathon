# FarmAgent Handoff Context

## Objective

Build a focused portfolio demo: one TypeScript agent using real tools, one
genuinely trained PyTorch model, and a thin Next.js/PWA interface. Prefer a small,
working system the developer can explain clearly over a broad feature set.

## Collaboration preferences

- Explain architectural data flow before individual lines.
- Focus on project logic and decisions, not familiar npm setup.
- Introduce unfamiliar concepts one at a time; avoid large information dumps.
- Use comprehension questions selectively for important or difficult code.
- Always name the source file when discussing code.
- Humans maintain `agent/src`; TypeScript generates `agent/dist`, so generated
  `.js` and `.d.ts` files should normally be ignored during walkthroughs.

## Implemented architecture

The TypeScript agent has a complete bounded client-side tool loop:

1. Convert registered tools into Anthropic tool definitions.
2. Send the user message and tool definitions to Anthropic.
3. Find returned `tool_use` blocks.
4. Verify that requested tool names are registered.
5. Validate model-generated input with each tool's Zod schema.
6. Dispatch valid calls to matching local tools.
7. Return outputs as `tool_result` blocks using the original tool-use IDs.
8. Preserve history and repeat until a final response or the round limit.

This is tested with a fake Anthropic client, not a live API key. Key files:

- `agent/src/tools/tool.ts`: shared tool contract.
- `agent/src/tools/crop-lookup.ts`: JSON-backed corn lookup.
- `agent/src/anthropic/request-turn.ts`: Anthropic schema conversion and input
  validation.
- `agent/src/tools/execute-tool-call.ts`: validated-call dispatch.
- `agent/src/anthropic/run-agent.ts`: bounded tool loop.
- `agent/src/anthropic/message-client.ts`: Anthropic SDK adapter.

The core safety rule is that model output is untrusted. JSON Schema guides
Claude; Zod enforces the contract at runtime. An unsupported crop is a valid
domain result (`found: false`), while an unknown tool or malformed input is
rejected before execution.

## Concepts already covered

- A tool combines a name, description, input schema, and `execute` behavior.
- Claude receives tool metadata, not executable functions.
- `call.name` selects the tool, `call.input` supplies validated arguments, and
  `call.id` correlates the result with Anthropic's request.
- Schema validation checks input shape, not whether domain data exists. For
  example, `{ crop: "rice" }` validates, then crop lookup returns not found.
- Tools belong in separate modules because crop lookup, weather, and diagnosis
  change for different reasons, although they share one contract.

## Planned tools

- `lookup_crop`: implemented for corn using static JSON.
- `get_weather`: not implemented; planned provider is Open-Meteo.
- `diagnose_crop_image`: not implemented; it will call the Python inference
  service rather than embedding PyTorch logic in TypeScript.

## Python model direction

Use the `mohanty/PlantVillage` Hugging Face dataset and filter its corn/maize
subset to four classes:

- Cercospora/gray leaf spot
- Common rust
- Northern leaf blight
- Healthy

Hugging Face handles distribution, metadata, caching, and a leaf-aware train/test
split. We still own corn filtering, a leakage-safe validation split, class
mapping, image transforms, augmentation, PyTorch data loaders, training, and
honest evaluation. PlantVillage uses controlled imagery, so benchmark accuracy
must not be presented as guaranteed field performance.

The intended boundary is:

```text
Next.js -> TypeScript agent -> diagnosis tool -> FastAPI/PyTorch
        <- final response   <- validated JSON <- prediction
```

Python owns preprocessing and model inference. TypeScript owns orchestration and
validates the FastAPI response. The frontend remains presentation-focused.

## Current model increment

`model/inspect_dataset.py` now implements the bounded dataset inspection step. It
loads the PlantVillage color dataset, filters and validates the four corn classes,
reports per-split counts and sampled image sizes, and rejects `leaf_id` overlap
between published splits. `model/README.md` documents the approximately 2 GB
download and the requirement to group future validation splits by physical leaf.

The helper logic has two passing unit tests. The full inspection ran on July 11,
2026 and found 3,058 corn images in published train, 794 in published test, and
256-by-256 sampled dimensions. It also found 216 physical-leaf IDs crossing the
published train/test boundary. Path inspection confirmed original/copy variants
of the same leaves in both splits. Do not use the published split for evaluation;
the next increment must combine corn rows and produce reproducible train,
validation, and test partitions grouped by `leaf_id`.

That grouped split is now implemented and verified. `model/prepare_splits.py`
creates a seeded, class-stratified 70/15/15 assignment of whole leaf groups and
writes `model/data/corn_splits.jsonl`. The manifest contains all 3,852 images:
2,703 train, 569 validation, and 580 test, with every image assigned exactly once,
all four classes present, and no leaf IDs crossing partitions. Two seed-42 runs
produced the same SHA-256 hash. This unblocked the PyTorch training/evaluation
pipeline described below.

The first model is now trained and evaluated. `model/train.py` fine-tunes an
ImageNet-pretrained MobileNetV3 Small with class-weighted cross-entropy, train-only
augmentation, validation after every epoch, and lowest-validation-loss checkpoint
selection. The seed-42 eight-epoch MPS run selected epoch 6 and achieved 98.28%
test accuracy and 97.68% macro F1. `model/eval.py` independently reproduced the
same loss, metrics, and confusion matrix from the saved checkpoint. The local
checkpoint is Git-ignored; `model/artifacts/test_metrics.json` records results.
The next increment is a minimal FastAPI inference service, followed by the
TypeScript diagnosis tool. Do not claim these controlled PlantVillage metrics as
field-photo performance.

## Verification and repository

- `npm run build` passes.
- `npm test` passes with eight tests.
- `python -m unittest discover -s model -p 'test_*.py'` passes with eight tests.
- Private repository: `https://github.com/njiedev/farmathon`
- Default branch: `main`
- Baseline before this document: `fffcb36`

For a new Codex session, read `AGENTS.MD`, this file, and the key source files
listed above before making changes.
