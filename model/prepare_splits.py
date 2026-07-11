"""Create leakage-safe corn train, validation, and test manifests."""

from __future__ import annotations

import argparse
import json
import random
from collections import Counter, defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

from inspect_dataset import (
    CORN_CROP,
    CORN_LABELS,
    DATASET_CONFIG,
    DATASET_LOADER_FILE,
    DATASET_NAME,
    DATASET_REVISION,
)

SPLIT_RATIOS = {"train": 0.70, "validation": 0.15, "test": 0.15}
DEFAULT_SEED = 42
DEFAULT_OUTPUT = Path(__file__).parent / "data" / "corn_splits.jsonl"


@dataclass(frozen=True)
class CornRecord:
    """Metadata needed to locate and group one corn image."""

    source_split: str
    source_index: int
    image_path: str
    label: str
    leaf_id: str


@dataclass(frozen=True)
class AssignedRecord:
    """One corn record with its generated leakage-safe split."""

    source_split: str
    source_index: int
    image_path: str
    label: str
    label_index: int
    leaf_id: str
    split: str


def group_records(
    records: Iterable[CornRecord],
) -> dict[str, tuple[CornRecord, ...]]:
    """Group records by physical leaf and reject inconsistent labels."""

    groups: defaultdict[str, list[CornRecord]] = defaultdict(list)
    seen_paths: set[str] = set()
    for record in records:
        if not record.leaf_id:
            raise ValueError("Every corn record must have a non-empty leaf_id")
        if record.label not in CORN_LABELS:
            raise ValueError(f"Unexpected corn label: {record.label}")
        if record.image_path in seen_paths:
            raise ValueError(f"Duplicate image path: {record.image_path}")
        seen_paths.add(record.image_path)
        groups[record.leaf_id].append(record)

    for leaf_id, group in groups.items():
        labels = {record.label for record in group}
        if len(labels) != 1:
            raise ValueError(
                f"Leaf {leaf_id} has conflicting labels: {sorted(labels)}"
            )

    return {leaf_id: tuple(group) for leaf_id, group in groups.items()}


def assign_groups(
    groups: Mapping[str, Sequence[CornRecord]], seed: int = DEFAULT_SEED
) -> list[AssignedRecord]:
    """Stratify whole leaf groups into deterministic 70/15/15 splits."""

    groups_by_label: defaultdict[str, list[str]] = defaultdict(list)
    for leaf_id, group in groups.items():
        if not group:
            raise ValueError(f"Leaf group {leaf_id} is empty")
        labels = {record.label for record in group}
        if len(labels) != 1:
            raise ValueError(f"Leaf {leaf_id} must have exactly one label")
        groups_by_label[group[0].label].append(leaf_id)

    missing_labels = set(CORN_LABELS) - set(groups_by_label)
    if missing_labels:
        raise ValueError(f"Missing corn classes: {sorted(missing_labels)}")

    leaf_assignments: dict[str, str] = {}
    rng = random.Random(seed)
    for label in CORN_LABELS:
        leaf_ids = sorted(groups_by_label[label])
        rng.shuffle(leaf_ids)
        train_end = int(len(leaf_ids) * SPLIT_RATIOS["train"])
        validation_end = train_end + int(
            len(leaf_ids) * SPLIT_RATIOS["validation"]
        )
        for leaf_id in leaf_ids[:train_end]:
            leaf_assignments[leaf_id] = "train"
        for leaf_id in leaf_ids[train_end:validation_end]:
            leaf_assignments[leaf_id] = "validation"
        for leaf_id in leaf_ids[validation_end:]:
            leaf_assignments[leaf_id] = "test"

    assigned = [
        AssignedRecord(
            source_split=record.source_split,
            source_index=record.source_index,
            image_path=record.image_path,
            label=record.label,
            label_index=CORN_LABELS.index(record.label),
            leaf_id=record.leaf_id,
            split=leaf_assignments[leaf_id],
        )
        for leaf_id, group in groups.items()
        for record in group
    ]
    return sorted(assigned, key=lambda record: (record.source_split, record.source_index))


def verify_assignments(
    source_records: Sequence[CornRecord], assigned: Sequence[AssignedRecord]
) -> None:
    """Verify completeness, uniqueness, class coverage, and leaf isolation."""

    source_paths = {record.image_path for record in source_records}
    assigned_paths = [record.image_path for record in assigned]
    if len(source_paths) != len(source_records):
        raise ValueError("Source records contain duplicate image paths")
    if Counter(assigned_paths) != Counter(source_paths):
        raise ValueError("Assigned records must contain every source image exactly once")

    leaf_splits: defaultdict[str, set[str]] = defaultdict(set)
    labels_by_split: defaultdict[str, set[str]] = defaultdict(set)
    for record in assigned:
        if record.split not in SPLIT_RATIOS:
            raise ValueError(f"Unknown generated split: {record.split}")
        leaf_splits[record.leaf_id].add(record.split)
        labels_by_split[record.split].add(record.label)

    leaking = [leaf_id for leaf_id, splits in leaf_splits.items() if len(splits) > 1]
    if leaking:
        raise ValueError(f"Leaf IDs cross generated splits: {sorted(leaking)[:3]}")
    for split_name in SPLIT_RATIOS:
        missing = set(CORN_LABELS) - labels_by_split[split_name]
        if missing:
            raise ValueError(f"{split_name} is missing classes: {sorted(missing)}")


def load_corn_records() -> list[CornRecord]:
    """Load corn metadata from both published PlantVillage splits."""

    from datasets import ClassLabel, load_dataset
    from huggingface_hub import hf_hub_download

    loader_path = hf_hub_download(
        repo_id=DATASET_NAME,
        filename=DATASET_LOADER_FILE,
        repo_type="dataset",
        revision=DATASET_REVISION,
    )
    dataset = load_dataset(loader_path, DATASET_CONFIG, trust_remote_code=True)
    label_feature = dataset["train"].features["label"]
    if not isinstance(label_feature, ClassLabel):
        raise TypeError("Expected label to be a datasets.ClassLabel")
    label_names = list(label_feature.names)

    records: list[CornRecord] = []
    for source_split, rows in dataset.items():
        metadata_rows = rows.remove_columns("image")
        for source_index, row in enumerate(metadata_rows):
            if row["crop"] != CORN_CROP:
                continue
            label_index = row["label"]
            if not isinstance(label_index, int):
                raise TypeError(f"Expected integer label, received {label_index!r}")
            records.append(
                CornRecord(
                    source_split=source_split,
                    source_index=source_index,
                    image_path=row["image_path"],
                    label=label_names[label_index],
                    leaf_id=row["leaf_id"],
                )
            )
    return records


def write_manifest(records: Sequence[AssignedRecord], output: Path) -> None:
    """Write stable JSON Lines records for the future training loader."""

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as manifest:
        for record in records:
            manifest.write(json.dumps(asdict(record), sort_keys=True) + "\n")


def print_summary(records: Sequence[AssignedRecord]) -> None:
    """Print image and unique-leaf counts by generated split and class."""

    for split_name in SPLIT_RATIOS:
        split_records = [record for record in records if record.split == split_name]
        print(f"\n{split_name}: {len(split_records)} images")
        for label in CORN_LABELS:
            class_records = [record for record in split_records if record.label == label]
            leaf_count = len({record.leaf_id for record in class_records})
            print(f"  {label}: {len(class_records)} images, {leaf_count} leaves")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    """Generate and verify the persisted grouped corn split manifest."""

    args = parse_args()
    source_records = load_corn_records()
    groups = group_records(source_records)
    assigned = assign_groups(groups, seed=args.seed)
    verify_assignments(source_records, assigned)
    write_manifest(assigned, args.output)

    print(f"Wrote {len(assigned)} records to {args.output}")
    print(f"Seed: {args.seed}; leaf groups: {len(groups)}")
    print_summary(assigned)
    print("\nVerified: every image appears once and leaf IDs are pairwise disjoint")


if __name__ == "__main__":
    main()
