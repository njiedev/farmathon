import unittest

from inspect_dataset import CORN_LABELS
from prepare_splits import CornRecord, assign_groups, group_records, verify_assignments


def records_per_class(groups_per_class: int = 8) -> list[CornRecord]:
    records: list[CornRecord] = []
    source_index = 0
    for label_index, label in enumerate(CORN_LABELS):
        for group_index in range(groups_per_class):
            leaf_id = f"leaf-{label_index}-{group_index}"
            for image_index in range(2 if group_index == 0 else 1):
                records.append(
                    CornRecord(
                        source_split="published",
                        source_index=source_index,
                        image_path=f"{leaf_id}-{image_index}.jpg",
                        label=label,
                        leaf_id=leaf_id,
                    )
                )
                source_index += 1
    return records


class PrepareSplitsTests(unittest.TestCase):
    def test_assigns_complete_leaf_groups_once(self) -> None:
        source = records_per_class()
        assigned = assign_groups(group_records(source), seed=42)

        verify_assignments(source, assigned)
        splits_by_leaf: dict[str, set[str]] = {}
        for record in assigned:
            splits_by_leaf.setdefault(record.leaf_id, set()).add(record.split)
        self.assertTrue(all(len(splits) == 1 for splits in splits_by_leaf.values()))

    def test_same_seed_produces_same_assignments(self) -> None:
        groups = group_records(records_per_class())

        first = assign_groups(groups, seed=7)
        second = assign_groups(groups, seed=7)

        self.assertEqual(first, second)

    def test_rejects_one_leaf_with_conflicting_labels(self) -> None:
        records = records_per_class()
        records.append(
            CornRecord(
                source_split="published",
                source_index=999,
                image_path="conflict.jpg",
                label=CORN_LABELS[1],
                leaf_id=records[0].leaf_id,
            )
        )

        with self.assertRaisesRegex(ValueError, "conflicting labels"):
            group_records(records)


if __name__ == "__main__":
    unittest.main()
