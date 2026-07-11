import unittest

from inspect_dataset import CORN_LABELS, SplitSummary, summarize_split, verify_no_leaf_leakage


class FakeImage:
    def __init__(self, size: tuple[int, int]) -> None:
        self.size = size


class InspectDatasetTests(unittest.TestCase):
    def test_summarizes_only_corn_and_bounds_image_decoding(self) -> None:
        labels = [*CORN_LABELS, "Apple___healthy"]
        rows = [
            {
                "crop": "Corn_(maize)",
                "label": 0,
                "leaf_id": "leaf-1",
                "image": FakeImage((256, 256)),
            },
            {
                "crop": "Corn_(maize)",
                "label": 1,
                "leaf_id": "leaf-2",
                "image": FakeImage((512, 512)),
            },
            {
                "crop": "Apple",
                "label": 4,
                "leaf_id": "leaf-3",
                "image": FakeImage((128, 128)),
            },
        ]

        summary = summarize_split(rows, labels, image_sample_limit=1)

        self.assertEqual(summary.class_counts[CORN_LABELS[0]], 1)
        self.assertEqual(summary.class_counts[CORN_LABELS[1]], 1)
        self.assertEqual(summary.leaf_ids, frozenset({"leaf-1", "leaf-2"}))
        self.assertEqual(summary.image_sizes, {(256, 256): 1})

    def test_rejects_leaf_leakage_between_splits(self) -> None:
        summary = SplitSummary({}, frozenset({"same-leaf"}), {})

        with self.assertRaisesRegex(ValueError, "Leaf leakage"):
            verify_no_leaf_leakage({"train": summary, "test": summary})

if __name__ == "__main__":
    unittest.main()
