import json
import tempfile
import unittest
from pathlib import Path

import torch

from inspect_dataset import CORN_LABELS
from training import metrics_from_confusion, read_manifest, select_device


class TrainingTests(unittest.TestCase):
    def test_metrics_from_known_confusion_matrix(self) -> None:
        confusion = torch.tensor(
            [[2, 0, 0, 0], [0, 1, 1, 0], [0, 0, 2, 0], [0, 0, 0, 2]]
        )

        metrics = metrics_from_confusion(confusion)

        self.assertEqual(metrics["accuracy"], 7 / 8)
        self.assertAlmostEqual(metrics["per_class"][CORN_LABELS[1]]["recall"], 0.5)
        self.assertEqual(metrics["confusion_matrix"], confusion.tolist())

    def test_manifest_rejects_mismatched_label_index(self) -> None:
        record = {
            "source_split": "train",
            "source_index": 1,
            "image_path": "image.jpg",
            "label": CORN_LABELS[0],
            "label_index": 3,
            "leaf_id": "leaf-1",
            "split": "train",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.jsonl"
            path.write_text(json.dumps(record) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "Label index mismatch"):
                read_manifest(path)

    def test_rejects_unavailable_cuda(self) -> None:
        if torch.cuda.is_available():
            self.skipTest("CUDA is available")
        with self.assertRaisesRegex(RuntimeError, "CUDA"):
            select_device("cuda")


if __name__ == "__main__":
    unittest.main()
