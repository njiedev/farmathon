import unittest

from inspect_dataset import CORN_LABELS
from serve.app import interpret_probabilities


class InferenceResponseTests(unittest.TestCase):
    def test_marks_clear_prediction_as_confident(self) -> None:
        result = interpret_probabilities([0.03, 0.9, 0.04, 0.03])

        self.assertEqual(result.prediction, CORN_LABELS[1])
        self.assertFalse(result.uncertain)
        self.assertEqual(len(result.scores), 4)

    def test_marks_close_predictions_as_uncertain(self) -> None:
        result = interpret_probabilities([0.4, 0.38, 0.12, 0.1])

        self.assertTrue(result.uncertain)
        self.assertIn("another", result.guidance)


if __name__ == "__main__":
    unittest.main()
