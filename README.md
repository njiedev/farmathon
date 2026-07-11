# Fieldhand

Fieldhand is a demo-ready farm operations agent for corn growers. It combines a
real trained PyTorch disease classifier, live Open-Meteo forecasts, crop/soil
data, multi-turn session memory, a persistent farm profile, and a responsive
Next.js PWA.

## Demo workflow

1. Open the field desk and edit the farm profile if needed.
2. Ask for today's field plan or whether conditions are suitable for spraying.
3. Ask a follow-up; the session retains the earlier farm context.
4. Upload a corn leaf photo to run the trained four-class classifier.
5. Inspect confidence, alternatives, retake guidance, and the forecast rail.
6. Refresh to see profile and conversation persistence; offline mode retains the
   last rendered field context.

## Run locally

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r model/requirements.txt
npm run demo
```

Open `http://localhost:3000`. The demo runs without API keys using deterministic
local orchestration. Set `ANTHROPIC_API_KEY` to use the bounded Anthropic tool-use
loop instead.

## Architecture

```text
Next.js PWA (:3000)
  -> TypeScript agent API (:8787)
       -> Open-Meteo weather
       -> JSON crop lookup
       -> Anthropic tool loop when configured
  -> FastAPI classifier (:8001)
       -> MobileNetV3 Small / PyTorch checkpoint
```

- `agent/`: tool contracts, Anthropic loop, weather/crop/diagnosis tools, session
  memory, profile-aware orchestration, and no-key demo behavior.
- `model/`: leakage-safe dataset preparation, training/evaluation, committed
  checkpoint and metrics, and FastAPI inference.
- `web/`: responsive field desk, structured results, image upload, browser voice
  input, persisted profile/history, and service-worker shell caching.
- `docs/`: engineering decisions, tutoring context, and reusable AI-assisted
  engineering playbook.

## Verification

```bash
npm run build
npm test
.venv/bin/python -m unittest discover -s model -p 'test_*.py'
```

The classifier supports four PlantVillage corn classes. Its benchmark results
must not be represented as guaranteed performance on arbitrary field images or
unsupported diseases.
