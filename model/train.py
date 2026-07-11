"""Train and evaluate the MobileNetV3 corn disease classifier."""

from __future__ import annotations

import argparse
from pathlib import Path

import torch
from torch import nn

from prepare_splits import DEFAULT_OUTPUT as DEFAULT_MANIFEST
from training import (
    checkpoint_payload,
    class_weights,
    create_loaders,
    create_model,
    load_checkpoint,
    read_manifest,
    run_epoch,
    seed_everything,
    select_device,
    write_metrics,
)

DEFAULT_CHECKPOINT = Path(__file__).parent / "artifacts" / "corn_mobilenet_v3_small.pt"
DEFAULT_METRICS = Path(__file__).parent / "artifacts" / "test_metrics.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--metrics", type=Path, default=DEFAULT_METRICS)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("auto", "cpu", "mps", "cuda"), default="auto")
    return parser.parse_args()


def main() -> None:
    """Fine-tune, select by validation loss, then evaluate test once."""

    args = parse_args()
    if args.epochs < 1 or args.batch_size < 1 or args.learning_rate <= 0:
        raise ValueError("epochs, batch size, and learning rate must be positive")
    seed_everything(args.seed)
    device = select_device(args.device)
    records = read_manifest(args.manifest)
    loaders = create_loaders(records, args.batch_size, args.num_workers)
    model = create_model(pretrained=True).to(device)
    loss_function = nn.CrossEntropyLoss(weight=class_weights(records, device))
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)

    print(f"Device: {device}; epochs: {args.epochs}; batch size: {args.batch_size}")
    best_loss = float("inf")
    for epoch in range(1, args.epochs + 1):
        train_metrics = run_epoch(model, loaders["train"], loss_function, device, optimizer)
        validation_metrics = run_epoch(
            model, loaders["validation"], loss_function, device
        )
        print(
            f"Epoch {epoch}/{args.epochs} "
            f"train loss={train_metrics['loss']:.4f} "
            f"accuracy={train_metrics['accuracy']:.4f}; "
            f"validation loss={validation_metrics['loss']:.4f} "
            f"accuracy={validation_metrics['accuracy']:.4f} "
            f"macro_f1={validation_metrics['macro_f1']:.4f}"
        )
        if validation_metrics["loss"] < best_loss:
            best_loss = validation_metrics["loss"]
            args.checkpoint.parent.mkdir(parents=True, exist_ok=True)
            torch.save(
                checkpoint_payload(model, epoch, validation_metrics, args.seed),
                args.checkpoint,
            )
            print(f"  Saved best checkpoint: {args.checkpoint}")

    best_model, payload = load_checkpoint(args.checkpoint, device)
    test_metrics = run_epoch(best_model, loaders["test"], loss_function, device)
    report = {
        "selected_epoch": payload["epoch"],
        "selection_metric": "validation_loss",
        "validation": payload["validation_metrics"],
        "test": test_metrics,
    }
    write_metrics(args.metrics, report)
    print(
        f"Test from epoch {payload['epoch']}: loss={test_metrics['loss']:.4f} "
        f"accuracy={test_metrics['accuracy']:.4f} "
        f"macro_f1={test_metrics['macro_f1']:.4f}"
    )
    print(f"Wrote metrics: {args.metrics}")


if __name__ == "__main__":
    main()
