"""Inspect the corn subset of PlantVillage before building a training pipeline."""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

DATASET_NAME = "mohanty/PlantVillage"
DATASET_CONFIG = "color"
DATASET_REVISION = "9e97599868962bd0079b8db4b7f1efa9185fa1e7"
DATASET_LOADER_FILE = "plant_village.py"
CORN_CROP = "Corn_(maize)"
CORN_LABELS = (
    "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot",
    "Corn_(maize)___Common_rust_",
    "Corn_(maize)___Northern_Leaf_Blight",
    "Corn_(maize)___healthy",
)
REQUIRED_COLUMNS = frozenset(
    {"image", "image_path", "label", "crop", "disease", "leaf_id"}
)


@dataclass(frozen=True)
class SplitSummary:
    """Counts and sampled image sizes for one corn dataset split."""

    class_counts: Counter[str]
    leaf_ids: frozenset[str]
    image_sizes: Counter[tuple[int, int]]


def label_name(row: Mapping[str, Any], label_names: list[str]) -> str:
    """Return the readable class label for a dataset row."""

    label = row["label"]
    if not isinstance(label, int) or not 0 <= label < len(label_names):
        raise ValueError(f"Invalid class index: {label!r}")
    return label_names[label]


def summarize_split(
    rows: Iterable[Mapping[str, Any]],
    label_names: list[str],
    image_sample_limit: int,
) -> SplitSummary:
    """Filter corn rows and collect class, leaf, and bounded image metadata."""

    class_counts: Counter[str] = Counter()
    leaf_ids: set[str] = set()
    image_sizes: Counter[tuple[int, int]] = Counter()

    for row in rows:
        if row["crop"] != CORN_CROP:
            continue

        name = label_name(row, label_names)
        if name not in CORN_LABELS:
            raise ValueError(f"Unexpected corn label: {name}")

        leaf_id = row["leaf_id"]
        if not isinstance(leaf_id, str) or not leaf_id:
            raise ValueError("Every corn row must have a non-empty leaf_id")

        class_counts[name] += 1
        leaf_ids.add(leaf_id)
        if sum(image_sizes.values()) < image_sample_limit:
            image = row["image"]
            image_sizes[tuple(image.size)] += 1

    return SplitSummary(class_counts, frozenset(leaf_ids), image_sizes)


def verify_no_leaf_leakage(summaries: Mapping[str, SplitSummary]) -> None:
    """Fail when a physical leaf occurs in more than one dataset split."""

    split_names = list(summaries)
    for index, left_name in enumerate(split_names):
        for right_name in split_names[index + 1 :]:
            overlap = summaries[left_name].leaf_ids & summaries[right_name].leaf_ids
            if overlap:
                examples = ", ".join(sorted(overlap)[:3])
                raise ValueError(
                    f"Leaf leakage between {left_name} and {right_name}: "
                    f"{len(overlap)} shared leaf IDs (examples: {examples})"
                )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image-samples",
        type=int,
        default=8,
        help="number of corn images to decode per split when checking dimensions",
    )
    return parser.parse_args()


def main() -> None:
    """Load PlantVillage and print the facts needed to design corn training."""

    args = parse_args()
    if args.image_samples < 0:
        raise ValueError("--image-samples must be non-negative")

    from datasets import ClassLabel, load_dataset
    from huggingface_hub import hf_hub_download

    loader_path = hf_hub_download(
        repo_id=DATASET_NAME,
        filename=DATASET_LOADER_FILE,
        repo_type="dataset",
        revision=DATASET_REVISION,
    )
    dataset = load_dataset(loader_path, DATASET_CONFIG, trust_remote_code=True)
    columns = set(dataset["train"].column_names)
    missing = REQUIRED_COLUMNS - columns
    if missing:
        raise ValueError(f"Dataset is missing required columns: {sorted(missing)}")

    label_feature = dataset["train"].features["label"]
    if not isinstance(label_feature, ClassLabel):
        raise TypeError("Expected label to be a datasets.ClassLabel")
    label_names = list(label_feature.names)

    summaries = {
        split_name: summarize_split(rows, label_names, args.image_samples)
        for split_name, rows in dataset.items()
    }

    print(f"Dataset: {DATASET_NAME} ({DATASET_CONFIG})")
    print(f"Columns: {', '.join(dataset['train'].column_names)}")
    for split_name, summary in summaries.items():
        print(f"\n{split_name}: {sum(summary.class_counts.values())} corn images")
        for name in CORN_LABELS:
            print(f"  {name}: {summary.class_counts[name]}")
        print(f"  unique leaf IDs: {len(summary.leaf_ids)}")
        print(f"  sampled image sizes: {dict(summary.image_sizes)}")
    verify_no_leaf_leakage(summaries)
    print("\nLeaf leakage across published splits: none")


if __name__ == "__main__":
    main()
