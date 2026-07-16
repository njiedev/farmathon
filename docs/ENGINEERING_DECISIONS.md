# Engineering Decisions and Debugging Stories

This document records substantive problems discovered while building FarmAgent.
Each entry separates evidence from assumptions and is structured so the decision
can be explained clearly in a technical interview.

## PlantVillage loading and split leakage

### Intended behavior

Before training, inspect the real PlantVillage color dataset to verify its schema,
four corn classes, image dimensions, class balance, and physical-leaf isolation
between train and test. The evaluation split must not contain another photograph
or copy of a leaf used during training.

### First observed symptom: wrong dataset configuration

Calling Hugging Face with the documented repository and `color` configuration
failed before downloading the image archive:

```text
ValueError: BuilderConfig 'color' not found. Available: ['default']
```

The available `default` representation exposed text manifests rather than the
documented image records. Continuing with it would have validated the wrong data
contract.

### Investigation and root cause

The repository is named `PlantVillage`, so Hugging Face's automatic resolver
looked for `PlantVillage.py`. The repository's custom loader is actually named
`plant_village.py`. When the expected script was not found, the client selected a
generated fallback representation with a different schema.

The loader itself correctly defines the `color` image configuration and fields
such as `image`, `label`, `crop`, `disease`, and `leaf_id`; it simply was not the
artifact selected by the automatic repository call.

### Loading decision

`model/inspect_dataset.py` now explicitly downloads `plant_village.py` from a
pinned dataset revision and passes the local loader path to `datasets`. This
avoids silently selecting the generated text representation and makes the loader
revision used by inspection explicit.

### Second observed symptom: published split leakage

After the correct approximately 2 GB image archive loaded, inspection reported:

| Class | Published train | Published test |
|---|---:|---:|
| Gray leaf spot | 406 | 107 |
| Common rust | 975 | 217 |
| Northern leaf blight | 765 | 220 |
| Healthy | 912 | 250 |
| **Total** | **3,058** | **794** |

Sampled images were 256 by 256 pixels. However, 216 physical-leaf IDs appeared
in both published splits.

Example paths included an original and copy variants divided across train and
test:

```text
train: .../R.S_HL 0597.JPG
train: .../R.S_HL 0597 copy.jpg
test:  .../R.S_HL 0597 copy 2.jpg
```

All 216 overlapping IDs came from the loader's fallback leaf-ID path. Reviewing
the associated filenames showed that the overlaps represented related copies,
not arbitrary ID collisions.

### Why this matters

Different photographs or copies of one physical leaf are correlated samples. If
one appears in training and another in test, the model can benefit from details
specific to a leaf it has effectively already seen. The resulting test accuracy
can overstate generalization to genuinely unseen leaves.

This is data leakage even when the image files are not byte-for-byte identical.

### Split decision and implementation

Do not use the published train/test split for model selection or final metrics.
The data-preparation implementation now:

1. Combine all corn rows from the published splits.
2. Group every row by `leaf_id`.
3. Assign whole leaf groups to reproducible train, validation, and test splits.
4. Verify that the three leaf-ID sets are pairwise disjoint.
5. Report per-class image and unique-leaf counts for every generated split.

The published test set is no longer treated as privileged because it already
shares physical leaves with published training data.

`model/prepare_splits.py` writes assignments to a JSONL manifest rather than
copying the image archive. The manifest retains the published source split and
row index, image path, readable class, numeric class index, leaf ID, and generated
split. This makes the assignment inspectable and reproducible while avoiding a
second copy of the approximately 2 GB source data.

The generated seed-42 split contains:

| Generated split | Images | Physical-leaf groups |
|---|---:|---:|
| Train | 2,703 | 2,175 |
| Validation | 569 | 464 |
| Test | 580 | 470 |

The target ratios apply to leaf-group counts within each class. Image counts are
necessarily approximate because multi-image leaf groups are indivisible.

### Verification evidence

- The inspection helper unit tests pass without downloading external data.
- The correct loader generated 43,596 total training and 10,709 total test image
  records before corn filtering.
- The real corn inspection reported the counts above and failed with 216 shared
  leaf IDs.
- Manual path inspection confirmed original/copy variants across the boundary.
- The inspector intentionally exits nonzero after printing its report, preventing
  a leaking split from being mistaken for a completed validation.
- The generated manifest assigns all 3,852 source images exactly once, includes
  all four classes in every split, and has pairwise-disjoint leaf-ID sets.
- Two independent seed-42 runs produced the identical SHA-256 hash
  `b4be7a4d7f749f27951887475a5b92414cd6361d1c54e15bde34aa72357071b3`.
- Three focused splitter tests cover whole-group assignment, deterministic output,
  and rejection of conflicting labels within a physical-leaf group.

### Remaining limitations

- The pinned loader script internally references the repository's `main` data
  URLs, so the loader code is pinned more strongly than its downloaded artifacts.
- PlantVillage uses controlled imagery. A leakage-safe test metric will still
  measure PlantVillage performance, not guaranteed performance on field photos.
- `leaf_id` quality depends partly on upstream filename and mapping logic; grouped
  splitting reduces known leakage but does not prove that every related image is
  labeled perfectly.

### Interview-ready explanation

> I added a real dataset inspection step before training rather than trusting the
> hosted split. That first exposed a loader-resolution problem: Hugging Face was
> silently selecting a text representation because the repository's custom loader
> filename did not match its repository name. I pinned and loaded the intended
> image loader explicitly. Once the real archive loaded, the inspector found 216
> physical-leaf IDs crossing the published train/test split, including original
> and copy variants. Using that split could inflate test accuracy, so I rejected
> it and designed a reproducible split that assigns complete leaf-ID groups to
> train, validation, or test. The important lesson was that a reputable dataset
> is still an external dependency, and the properties your evaluation relies on
> need to be verified against the real data.

## Transfer-learning baseline and checkpoint selection

### Intended behavior

Train a real four-class corn disease model without hiding the train, validation,
and test boundaries. The final artifact must be selected automatically using
validation evidence and independently reloadable for test evaluation.

### Model decision

The baseline uses ImageNet-pretrained MobileNetV3 Small rather than training from
scratch or selecting an undocumented plant-specific checkpoint. The dataset has
only 3,852 corn images, so broad pretrained visual features reduce data needs.
MobileNet is small enough for the planned FastAPI service, is maintained by
Torchvision, and has documented preprocessing. A plant-specific checkpoint could
already contain PlantVillage examples and silently contaminate evaluation.

The final classifier layer was replaced with four outputs. All parameters were
fine-tuned using AdamW and class-weighted cross-entropy. Class weighting prevents
the larger common-rust class from dominating the smaller gray-leaf-spot class.

### Evaluation policy

Training images receive random resized crops, horizontal flips, and small
rotations. Validation and test transformations are deterministic. After each
epoch, validation runs without gradients or weight updates. A checkpoint is saved
only when class-weighted validation loss reaches a new minimum. Test evaluation
loads that checkpoint rather than using the final in-memory epoch.

The eight-epoch seed-42 MPS run selected epoch 6:

```text
validation loss:     0.0831
validation accuracy: 97.01%
validation macro F1: 95.64%
test loss:           0.0417
test accuracy:       98.28%
test macro F1:       97.68%
```

Epochs 7 and 8 did not improve validation loss, so automatic selection avoided
using the last epoch merely because it was last.

### Problems caught during verification

The required one-epoch smoke run originally executed the test phase as part of
the complete pipeline. That exposed test metrics before the full run. No model,
augmentation, learning rate, epoch count, or other setting was changed in response;
the already-declared eight-epoch configuration was run unchanged. Future smoke
runs should support skipping test evaluation so the held-out set stays concealed.

Independent evaluation also initially used unweighted cross-entropy while the
training command's final evaluation used the class-weighted loss. Accuracy and F1
matched, but the reported loss would not have been comparable. `model/eval.py`
was corrected to reconstruct the same training class weights. It then reproduced
loss, accuracy, macro F1, and the confusion matrix exactly.

### Verification evidence

- Eight focused Python tests pass, including known confusion-matrix metrics,
  malformed manifest rejection, and unavailable-device failure.
- A real two-image batch resolved from the manifest to tensors shaped
  `2 x 3 x 224 x 224`, and the model produced `2 x 4` logits.
- The one-epoch smoke run completed training, validation, checkpoint save/load,
  and test reporting on Apple MPS.
- The full eight-epoch run selected epoch 6 by validation loss.
- Standalone evaluation reproduced the exact test confusion matrix:
  `[[78, 0, 2, 0], [0, 180, 0, 0], [7, 0, 136, 1], [0, 0, 0, 176]]`.

### Remaining limitations

- The checkpoint is local and has not yet been loaded by an inference service.
- The test set was exposed once during the smoke run, although no decisions were
  changed in response.
- Softmax scores are not calibrated probabilities of diagnostic correctness.
- The model supports exactly four corn classes and must not silently diagnose
  unsupported crops, diseases, or out-of-distribution field images.
- High performance on controlled PlantVillage images does not demonstrate the
  same accuracy in real farm conditions.

### Interview-ready explanation

> I chose MobileNetV3 Small as a reproducible transfer-learning baseline because
> the dataset was modest and the model needed to be lightweight enough to serve.
> I kept training, validation, and test responsibilities explicit: training alone
> updated weights, validation loss selected the checkpoint automatically, and test
> evaluation restored that saved artifact. The final leakage-safe PlantVillage
> result was 98.28% accuracy and 97.68% macro F1. During independent evaluation I
> found that the standalone script used an unweighted loss while training used a
> class-weighted loss; I aligned them and verified exact reproduction of every
> aggregate metric and the confusion matrix. I report the result as a controlled
> benchmark, not evidence of equivalent field-photo diagnosis.

## Demo-ready vertical slice

### Product decision

The accelerated branch prioritizes one coherent field workflow over a collection
of disconnected features. A farmer can persist a farm profile, ask multi-turn
questions, receive real weather and proactive risk context, upload a leaf image,
and inspect a confidence-aware trained-model result in one responsive field desk.

The service has two orchestration modes. When `ANTHROPIC_API_KEY` is configured,
the bounded Anthropic tool loop uses the registered crop, weather, and diagnosis
tools. Without a key, deterministic local orchestration exercises the same data
sources and produces a reliable interview demo rather than failing at startup.

### Interface decision

The visual direction borrows the supplied AgAnswers reference's immersive field
photography, editorial serif typography, and restrained agricultural palette,
without copying its branding or landing-page layout. The first viewport is the
actual operational product: field identity above a chat workspace and structured
signal rail. A generated original corn-field photograph is committed as the hero
asset.

The farm profile and conversation persist in browser storage. The server retains
active session turns in memory. The PWA caches its shell and last rendered state,
while live POST requests correctly remain unavailable offline. Browser speech
recognition is progressive enhancement and is not assumed on unsupported browsers.

### Confidence-aware diagnosis

FastAPI computes all four softmax scores and marks a result uncertain when the
top score is below 72% or its lead over the runner-up is below 18 percentage
points. Uncertain responses ask for a close, well-lit retake instead of presenting
a forced class as fact. Every response states the four-class controlled-image
scope. These thresholds are product safeguards, not statistically calibrated
probabilities, and should be revisited with field validation data.

### Verification and remaining risks

- Production TypeScript and Next.js builds pass.
- Eight TypeScript and ten Python tests pass.
- Live Open-Meteo geocoding/forecast calls passed through the Next.js proxy.
- A held-out common-rust image passed through Next.js, FastAPI, the committed
  checkpoint, and the structured response contract with 99.97% model confidence.
- Location fallback was added after `Champaign, Illinois` failed provider lookup
  while `Champaign` succeeded.
- The in-app browser runtime exposed no browser, so screenshot-based responsive
  QA was not possible and remains a manual check.
- `npm audit` reports two moderate findings caused by Next.js nesting vulnerable
  PostCSS 8.4.31. There are no high or critical findings; npm suggests a breaking
  and invalid Next 9 downgrade, so the dependency risk is documented rather than
  disguised by an ineffective root override.
- Session memory is process-local and farm persistence is browser-local; a real
  multi-user product would require authenticated durable storage.
- A second tabular trained model was not added because there was no selected,
  audited dataset to support an honest yield or irrigation target within scope.

## Recoverable runtime tool failures

### Intended behavior

When the model requests multiple independent tools, one unavailable dependency
should not erase successful sibling results or force the entire chat request to
return HTTP 500. The model should receive enough structured information to use
the successful results and explain which live dependency was unavailable.

### Observed symptom and root cause

`runAgent` executed validated calls with `Promise.all`. Tool validation failures
were already represented as `tool_result` blocks with `is_error: true`, but an
exception thrown inside a valid tool rejected its promise. That caused
`Promise.all` and then the whole agent loop to reject before any results were
returned to the model.

This was fail-fast behavior at the wrong boundary. A weather-provider failure is
a tool-level outcome the orchestrator can often recover from; it is not
necessarily an agent-level failure.

### Decision and implementation

Each validated tool call now catches its own execution exception and resolves to
a correlated Anthropic `tool_result` block containing:

- The original `tool_use_id`
- `is_error: true`
- The `tool_execution_failed` error code
- The tool name and failure message

Calls still execute concurrently with `Promise.all`, but their promises now
resolve to either successful or failed result blocks. Agent-level failures such
as exhausting the tool-round limit still terminate the request.

### Verification evidence

A focused regression test requests crop lookup and weather in the same model
turn. Crop lookup succeeds while the weather tool throws
`Forecast failed: 500`. The next model request contains both the successful crop
output and the weather error under their original tool-use IDs, and the model can
then return a final response. All nine TypeScript tests pass.

### Remaining limitations

- The failure message is supplied to the model but is not yet stored in a
  durable trace or associated with retry metadata.
- The agent does not classify transient versus permanent failures or apply
  bounded retries.
- Deterministic no-key orchestration still calls tools directly and retains its
  existing HTTP failure behavior.

### Interview-ready explanation

> I found that malformed model calls were recoverable, but valid tool calls that
> encountered provider failures crashed the entire loop. Because calls ran under
> fail-fast `Promise.all`, one weather outage also discarded a successful crop
> result. I moved exception handling to the individual tool-call boundary and
> converted runtime failures into correlated error result blocks. This preserves
> concurrency, lets the model degrade gracefully with partial information, and
> keeps true agent-level failures explicit.
