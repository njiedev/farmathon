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

## Recommended next increment

Create only a Python dataset inspection script before training or FastAPI code:

1. Load the PlantVillage color dataset.
2. Filter the four corn classes.
3. Print class names and per-split counts.
4. Verify image dimensions, label mappings, and `leaf_id` availability.
5. Document the observed data and leakage constraints.

Do not add training, serving, diagnosis, and weather in the same increment.

## Verification and repository

- `npm run build` passes.
- `npm test` passes with eight tests.
- Private repository: `https://github.com/njiedev/farmathon`
- Default branch: `main`
- Baseline before this document: `fffcb36`

For a new Codex session, read `AGENTS.MD`, this file, and the key source files
listed above before making changes.
