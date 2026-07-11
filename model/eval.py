"""Evaluate a saved corn classifier checkpoint on the untouched test split."""

from __future__ import annotations

import argparse
from pathlib import Path

from torch import nn

from prepare_splits import DEFAULT_OUTPUT as DEFAULT_MANIFEST
from train import DEFAULT_CHECKPOINT, DEFAULT_METRICS
from training import (
    class_weights,
    create_loaders,
    load_checkpoint,
    read_manifest,
    run_epoch,
    select_device,
    write_metrics,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--metrics", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    return parser.parse_args()


def main() -> None:
    """Restore checkpoint metadata and report deterministic test metrics."""

    args = parse_args()
    device = select_device(args.device)
    records = read_manifest(args.manifest)
    loaders = create_loaders(records, args.batch_size, args.num_workers)
    model, payload = load_checkpoint(args.checkpoint, device)
    loss_function = nn.CrossEntropyLoss(weight=class_weights(records, device))
    metrics = run_epoch(model, loaders["test"], loss_function, device)
    report = {
        "selected_epoch": payload["epoch"],
        "selection_metric": "validation_loss",
        "validation": payload["validation_metrics"],
        "test": metrics,
    }
    write_metrics(args.metrics, report)
    print(
        f"Test: loss={metrics['loss']:.4f} accuracy={metrics['accuracy']:.4f} "
        f"macro_f1={metrics['macro_f1']:.4f}"
    )
    print(f"Confusion matrix: {metrics['confusion_matrix']}")


if __name__ == "__main__":
    main()
