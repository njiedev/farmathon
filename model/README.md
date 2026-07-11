# Model dataset inspection

The first model increment inspects the published PlantVillage color splits before
training. It verifies the expected schema and four corn classes, reports per-split
counts and sampled image dimensions, and rejects any `leaf_id` overlap between
splits.

The upstream image archive is about 2 GB. Run this intentionally rather than as
part of the fast repository test suite:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r model/requirements.txt
python model/inspect_dataset.py
```

PlantVillage contains multiple photographs of some physical leaves. Future
train/validation splitting must group by `leaf_id`; a random image-level split
would leak near-duplicate leaf images and inflate validation accuracy.

The Hugging Face repository's loader filename does not match the automatic name
derived from its repository, which otherwise causes `datasets` to load an
unrelated generated text view. The inspector explicitly downloads the custom
loader from a pinned dataset revision before loading the `color` configuration.

## Observed dataset facts

The real inspection was run on July 11, 2026. All sampled images were 256 by 256
pixels. The corn subset contained:

| Class | Published train | Published test |
|---|---:|---:|
| Gray leaf spot | 406 | 107 |
| Common rust | 975 | 217 |
| Northern leaf blight | 765 | 220 |
| Healthy | 912 | 250 |
| **Total** | **3,058** | **794** |

There were 2,561 unique leaf IDs in train and 764 in test, but 216 IDs occurred
in both splits. Inspection of the paths confirmed that these are original/copy
variants of the same physical leaves, not just arbitrary fallback-ID collisions.
The published split is therefore unsuitable for our final evaluation. Training
must combine the corn rows and create new train, validation, and test partitions
grouped by `leaf_id`.

Run the local logic tests without downloading the dataset:

```bash
python -m unittest discover -s model -p 'test_*.py'
```

## Leakage-safe generated splits

Generate the training manifest after the dataset is cached:

```bash
python model/prepare_splits.py
```

The command combines the published corn rows, groups them by physical leaf,
stratifies whole groups within each disease class using a fixed seed, and writes
`model/data/corn_splits.jsonl`. The generated ratios are 70% train, 15%
validation, and 15% test by leaf-group count within each class. Ratios by image
count are approximate because a leaf group is never divided.

The manifest references the original dataset rows and image paths instead of
copying the image archive. It is verified for complete row coverage, unique image
assignment, all-class coverage, and pairwise leaf-ID isolation before writing.

The real seed-42 manifest contains 3,109 physical-leaf groups and 3,852 images:

| Generated split | Images | Percentage |
|---|---:|---:|
| Train | 2,703 | 70.17% |
| Validation | 569 | 14.77% |
| Test | 580 | 15.06% |

Two consecutive generation runs produced the same SHA-256 hash:
`b4be7a4d7f749f27951887475a5b92414cd6361d1c54e15bde34aa72357071b3`.

## Training and evaluation

The baseline fine-tunes an ImageNet-pretrained MobileNetV3 Small on the generated
corn splits. Training uses random crops, horizontal flips, and small rotations;
validation and test use deterministic resize and center-crop transforms. All
images use the pretrained weights' ImageNet normalization.

```bash
python model/train.py --epochs 8 --batch-size 32
python model/eval.py --batch-size 32
```

The training loop uses class-weighted cross-entropy and AdamW, evaluates validation
after every epoch, and saves a checkpoint only when validation loss improves. The
checkpoint contains the weights, class order, architecture, preprocessing values,
selected epoch, seed, and validation metrics. The standalone evaluator validates
that metadata before loading weights.

The seed-42 baseline ran on Apple MPS and selected epoch 6 of 8:

| Metric | Validation | Test |
|---|---:|---:|
| Loss | 0.0831 | 0.0417 |
| Accuracy | 97.01% | 98.28% |
| Macro F1 | 95.64% | 97.68% |

Test F1 by class was 94.55% gray leaf spot, 100% common rust, 96.45% northern
leaf blight, and 99.72% healthy. Full machine-readable results and the confusion
matrix are in `model/artifacts/test_metrics.json`. The `.pt` checkpoint is kept
local and ignored by Git.

These metrics apply only to the leakage-safe PlantVillage corn split. PlantVillage
uses controlled leaf imagery, so they do not establish equivalent performance on
farmer-uploaded field photographs or unsupported diseases.
