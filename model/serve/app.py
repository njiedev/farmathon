"""FastAPI service for the trained corn disease classifier."""

from __future__ import annotations

import io
import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from inspect_dataset import CORN_LABELS
from training import evaluation_transform, load_checkpoint, select_device

DEFAULT_CHECKPOINT = Path(__file__).parents[1] / "artifacts" / "corn_mobilenet_v3_small.pt"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
CONFIDENCE_THRESHOLD = 0.72
MARGIN_THRESHOLD = 0.18

DISPLAY_NAMES = {
    CORN_LABELS[0]: "Gray leaf spot",
    CORN_LABELS[1]: "Common rust",
    CORN_LABELS[2]: "Northern leaf blight",
    CORN_LABELS[3]: "Healthy",
}


class ClassScore(BaseModel):
    label: str
    display_name: str
    confidence: float = Field(ge=0, le=1)


class DiagnosisResponse(BaseModel):
    prediction: str
    display_name: str
    confidence: float = Field(ge=0, le=1)
    uncertain: bool
    guidance: str
    alternatives: list[ClassScore]
    scores: list[ClassScore]
    model_scope: str


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    checkpoint_exists: bool


class Predictor:
    def __init__(self, checkpoint: Path, device_name: str = "auto") -> None:
        self.device = select_device(device_name)
        self.model, self.metadata = load_checkpoint(checkpoint, self.device)
        self.model.eval()
        self.transform = evaluation_transform()

    def predict(self, image: Image.Image) -> DiagnosisResponse:
        tensor = self.transform(image.convert("RGB")).unsqueeze(0).to(self.device)
        with torch.inference_mode():
            probabilities = torch.softmax(self.model(tensor), dim=1)[0].cpu().tolist()
        return interpret_probabilities(probabilities)


def interpret_probabilities(probabilities: list[float]) -> DiagnosisResponse:
    if len(probabilities) != len(CORN_LABELS):
        raise ValueError("Classifier output does not match the four-class mapping")
    ranked = sorted(
        [
            ClassScore(
                label=label,
                display_name=DISPLAY_NAMES[label],
                confidence=float(probability),
            )
            for label, probability in zip(CORN_LABELS, probabilities, strict=True)
        ],
        key=lambda score: score.confidence,
        reverse=True,
    )
    top, runner_up = ranked[0], ranked[1]
    uncertain = (
        top.confidence < CONFIDENCE_THRESHOLD
        or top.confidence - runner_up.confidence < MARGIN_THRESHOLD
    )
    guidance = (
        "The result is uncertain. Take another close, well-lit photo of one leaf, "
        "including both healthy and damaged tissue."
        if uncertain
        else "Use this as a screening result and confirm symptoms before treatment."
    )
    return DiagnosisResponse(
        prediction=top.label,
        display_name=top.display_name,
        confidence=top.confidence,
        uncertain=uncertain,
        guidance=guidance,
        alternatives=ranked[1:3],
        scores=ranked,
        model_scope="Four PlantVillage corn classes; controlled-image benchmark only.",
    )


@lru_cache(maxsize=1)
def get_predictor() -> Predictor:
    checkpoint = Path(os.getenv("FARMAGENT_CHECKPOINT", DEFAULT_CHECKPOINT))
    device = os.getenv("FARMAGENT_DEVICE", "auto")
    return Predictor(checkpoint, device)


app = FastAPI(title="FarmAgent Classifier", version="0.1.0")


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    checkpoint = Path(os.getenv("FARMAGENT_CHECKPOINT", DEFAULT_CHECKPOINT))
    return HealthResponse(
        status="ok" if checkpoint.is_file() else "model_missing",
        model_loaded=get_predictor.cache_info().currsize > 0,
        checkpoint_exists=checkpoint.is_file(),
    )


@app.post("/predict", response_model=DiagnosisResponse)
async def predict(image: Annotated[UploadFile, File()]) -> DiagnosisResponse:
    if image.content_type is None or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Upload must be an image")
    contents = await image.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds 10 MB")
    try:
        decoded = Image.open(io.BytesIO(contents))
        decoded.load()
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=400, detail="Image could not be decoded") from error
    try:
        return get_predictor().predict(decoded)
    except FileNotFoundError as error:
        raise HTTPException(status_code=503, detail="Model checkpoint is unavailable") from error
