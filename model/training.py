"""Shared data, model, training, and evaluation components for corn diagnosis."""

from __future__ import annotations

import json
import random
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from torch import Tensor, nn
from torch.utils.data import DataLoader, Dataset
from torchvision import transforms
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

from inspect_dataset import (
    CORN_LABELS,
    DATASET_CONFIG,
    DATASET_LOADER_FILE,
    DATASET_NAME,
    DATASET_REVISION,
)

ARCHITECTURE = "mobilenet_v3_small"
IMAGE_SIZE = 224
NORMALIZE_MEAN = (0.485, 0.456, 0.406)
NORMALIZE_STD = (0.229, 0.224, 0.225)


@dataclass(frozen=True)
class ManifestRecord:
    source_split: str
    source_index: int
    image_path: str
    label: str
    label_index: int
    leaf_id: str
    split: str


def seed_everything(seed: int) -> None:
    """Seed Python and PyTorch for repeatable data ordering and initialization."""

    random.seed(seed)
    torch.manual_seed(seed)


def select_device(requested: str) -> torch.device:
    """Select an available accelerator or fail for an unavailable explicit choice."""

    if requested == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested but is not available")
    if requested == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is not available")
    return torch.device(requested)


def read_manifest(path: Path) -> list[ManifestRecord]:
    """Read and validate the generated JSONL split manifest."""

    if not path.is_file():
        raise FileNotFoundError(f"Split manifest not found: {path}")
    records: list[ManifestRecord] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        try:
            raw = json.loads(line)
            record = ManifestRecord(**raw)
        except (json.JSONDecodeError, TypeError) as error:
            raise ValueError(f"Invalid manifest record on line {line_number}") from error
        if record.label not in CORN_LABELS:
            raise ValueError(f"Unexpected label on line {line_number}: {record.label}")
        if record.label_index != CORN_LABELS.index(record.label):
            raise ValueError(f"Label index mismatch on line {line_number}")
        if record.split not in {"train", "validation", "test"}:
            raise ValueError(f"Unknown split on line {line_number}: {record.split}")
        records.append(record)
    if not records:
        raise ValueError("Split manifest is empty")
    return records


def load_source_dataset() -> Any:
    """Load the pinned PlantVillage image dataset used by the manifest."""

    from datasets import load_dataset
    from huggingface_hub import hf_hub_download

    loader_path = hf_hub_download(
        repo_id=DATASET_NAME,
        filename=DATASET_LOADER_FILE,
        repo_type="dataset",
        revision=DATASET_REVISION,
    )
    return load_dataset(loader_path, DATASET_CONFIG, trust_remote_code=True)


def training_transform() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.RandomResizedCrop(IMAGE_SIZE, scale=(0.8, 1.0)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(10),
            transforms.ToTensor(),
            transforms.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
        ]
    )


def evaluation_transform() -> transforms.Compose:
    return transforms.Compose(
        [
            transforms.Resize(256),
            transforms.CenterCrop(IMAGE_SIZE),
            transforms.ToTensor(),
            transforms.Normalize(NORMALIZE_MEAN, NORMALIZE_STD),
        ]
    )


class ManifestImageDataset(Dataset[tuple[Tensor, int]]):
    """Resolve manifest records back to images in the cached source dataset."""

    def __init__(
        self,
        source_dataset: Any,
        records: Sequence[ManifestRecord],
        split: str,
        transform: transforms.Compose,
    ) -> None:
        self.source_dataset = source_dataset
        self.records = [record for record in records if record.split == split]
        self.transform = transform
        if not self.records:
            raise ValueError(f"Manifest has no records for {split}")

        metadata = {
            source_split: rows.remove_columns("image")
            for source_split, rows in source_dataset.items()
        }
        for record in self.records:
            if record.source_split not in metadata:
                raise ValueError(f"Unknown source split: {record.source_split}")
            if not 0 <= record.source_index < len(metadata[record.source_split]):
                raise ValueError(f"Source index out of range: {record.source_index}")
            source_row = metadata[record.source_split][record.source_index]
            if source_row["image_path"] != record.image_path:
                raise ValueError(f"Source image mismatch: {record.image_path}")

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[Tensor, int]:
        record = self.records[index]
        row = self.source_dataset[record.source_split][record.source_index]
        image = row["image"]
        if not isinstance(image, Image.Image):
            raise TypeError(f"Expected PIL image for {record.image_path}")
        return self.transform(image.convert("RGB")), record.label_index


def create_loaders(
    records: Sequence[ManifestRecord], batch_size: int, num_workers: int
) -> dict[str, DataLoader[tuple[Tensor, int]]]:
    """Create train, validation, and test loaders from one source dataset."""

    source_dataset = load_source_dataset()
    loaders: dict[str, DataLoader[tuple[Tensor, int]]] = {}
    for split in ("train", "validation", "test"):
        dataset = ManifestImageDataset(
            source_dataset,
            records,
            split,
            training_transform() if split == "train" else evaluation_transform(),
        )
        loaders[split] = DataLoader(
            dataset,
            batch_size=batch_size,
            shuffle=split == "train",
            num_workers=num_workers,
        )
    return loaders


def create_model(pretrained: bool) -> nn.Module:
    """Create MobileNetV3 Small with a four-class output layer."""

    weights = MobileNet_V3_Small_Weights.DEFAULT if pretrained else None
    model = mobilenet_v3_small(weights=weights)
    final_layer = model.classifier[-1]
    if not isinstance(final_layer, nn.Linear):
        raise TypeError("Unexpected MobileNetV3 classifier structure")
    model.classifier[-1] = nn.Linear(final_layer.in_features, len(CORN_LABELS))
    return model


def class_weights(records: Sequence[ManifestRecord], device: torch.device) -> Tensor:
    """Balance training loss so smaller classes contribute proportionally."""

    counts = Counter(record.label_index for record in records if record.split == "train")
    if set(counts) != set(range(len(CORN_LABELS))):
        raise ValueError("Training split must contain every class")
    total = sum(counts.values())
    return torch.tensor(
        [total / (len(CORN_LABELS) * counts[index]) for index in range(len(CORN_LABELS))],
        dtype=torch.float32,
        device=device,
    )


def metrics_from_confusion(confusion: Tensor) -> dict[str, Any]:
    """Calculate accuracy and per-class precision, recall, and F1."""

    matrix = confusion.to(torch.float64)
    total = matrix.sum().item()
    accuracy = matrix.diag().sum().item() / total if total else 0.0
    per_class: dict[str, dict[str, float | int]] = {}
    f1_values: list[float] = []
    for index, label in enumerate(CORN_LABELS):
        true_positive = matrix[index, index].item()
        predicted = matrix[:, index].sum().item()
        actual = matrix[index, :].sum().item()
        precision = true_positive / predicted if predicted else 0.0
        recall = true_positive / actual if actual else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        f1_values.append(f1)
        per_class[label] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": int(actual),
        }
    return {
        "accuracy": accuracy,
        "macro_f1": sum(f1_values) / len(f1_values),
        "per_class": per_class,
        "confusion_matrix": confusion.tolist(),
    }


def run_epoch(
    model: nn.Module,
    loader: DataLoader[tuple[Tensor, int]],
    loss_function: nn.Module,
    device: torch.device,
    optimizer: torch.optim.Optimizer | None = None,
) -> dict[str, Any]:
    """Run one training or evaluation epoch and return aggregate metrics."""

    training = optimizer is not None
    model.train(training)
    confusion = torch.zeros((len(CORN_LABELS), len(CORN_LABELS)), dtype=torch.int64)
    total_loss = 0.0
    total_examples = 0

    with torch.set_grad_enabled(training):
        for images, labels in loader:
            images = images.to(device)
            labels = labels.to(device)
            if training:
                optimizer.zero_grad()
            logits = model(images)
            loss = loss_function(logits, labels)
            if training:
                loss.backward()
                optimizer.step()

            batch_size = labels.size(0)
            total_loss += loss.item() * batch_size
            total_examples += batch_size
            predictions = logits.argmax(dim=1)
            for actual, predicted in zip(labels.cpu(), predictions.cpu(), strict=True):
                confusion[actual.item(), predicted.item()] += 1

    metrics = metrics_from_confusion(confusion)
    metrics["loss"] = total_loss / total_examples
    return metrics


def checkpoint_payload(
    model: nn.Module,
    epoch: int,
    validation_metrics: Mapping[str, Any],
    seed: int,
) -> dict[str, Any]:
    return {
        "architecture": ARCHITECTURE,
        "class_names": list(CORN_LABELS),
        "image_size": IMAGE_SIZE,
        "normalize_mean": list(NORMALIZE_MEAN),
        "normalize_std": list(NORMALIZE_STD),
        "epoch": epoch,
        "seed": seed,
        "validation_metrics": dict(validation_metrics),
        "model_state_dict": model.state_dict(),
    }


def load_checkpoint(path: Path, device: torch.device) -> tuple[nn.Module, dict[str, Any]]:
    """Validate checkpoint metadata and restore a model for evaluation."""

    if not path.is_file():
        raise FileNotFoundError(f"Checkpoint not found: {path}")
    payload = torch.load(path, map_location=device, weights_only=True)
    if payload.get("architecture") != ARCHITECTURE:
        raise ValueError(f"Unsupported checkpoint architecture: {payload.get('architecture')}")
    if payload.get("class_names") != list(CORN_LABELS):
        raise ValueError("Checkpoint class mapping does not match this application")
    model = create_model(pretrained=False).to(device)
    model.load_state_dict(payload["model_state_dict"])
    return model, payload


def write_metrics(path: Path, metrics: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
