"""
SmartGate plate recognition: an HTTP wrapper around FastALPR's pretrained ONNX
models (YOLOv9 plate detector + fast-plate-ocr), with the digit-only decoding,
multi-crop voting and completeness checks in plate_reader.py.

The ParkFlow API forwards each camera frame here as raw JPEG/PNG bytes. Frames
are not stored, unless ALPR_SAVE_FRAMES names a local folder for collecting
test frames. Database matching stays in the ParkFlow API.
"""

import json
import os
import time
import uuid

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Request

from plate_reader import MAX_DIGITS, MIN_DIGITS, PlateReader

DETECTOR_MODEL = os.getenv("ALPR_DETECTOR_MODEL", "yolo-v9-t-384-license-plate-end2end")
# The first model reads every plate; the others are consulted only when it is not decisive.
OCR_MODELS = [m.strip() for m in os.getenv("ALPR_OCR_MODELS", "cct-xs-v2-global-model,cct-s-v2-global-model").split(",") if m.strip()]
DETECTOR_CONF = float(os.getenv("ALPR_DETECTOR_CONF", "0.3"))
TOKEN = os.getenv("ALPR_TOKEN", "")
# Local testing only: save each frame and its result to this folder. Leave unset otherwise.
SAVE_FRAMES = os.getenv("ALPR_SAVE_FRAMES", "")
MAX_BYTES = 8 * 1024 * 1024
# Phone photos are 12 MP; plates stay sharp at this size and detection stays fast.
MAX_SIDE = 1600

# Models download once on first start (to the user cache) and stay in memory.
reader = PlateReader(DETECTOR_MODEL, OCR_MODELS, DETECTOR_CONF)
app = FastAPI(title="ParkFlow SmartGate ALPR", docs_url=None, redoc_url=None)


@app.get("/health")
def health():
    return {"status": "ok", "detector": DETECTOR_MODEL, "ocr": OCR_MODELS, "digits": [MIN_DIGITS, MAX_DIGITS]}


@app.post("/recognize")
async def recognize(request: Request):
    if TOKEN and request.headers.get("x-alpr-token") != TOKEN:
        raise HTTPException(status_code=401, detail="Invalid ALPR token")
    body = await request.body()
    if not body or len(body) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Send one image up to 8 MB")
    frame = cv2.imdecode(np.frombuffer(body, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="The image could not be decoded")
    height, width = frame.shape[:2]
    scale = MAX_SIDE / max(height, width)
    if scale < 1:
        frame = cv2.resize(frame, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)

    started = time.perf_counter()
    plates = [{
        # Digits only, exactly as read: never padded, never completed.
        "digits": p.digits,
        "complete": p.complete,
        "reason": p.reason,
        "confidence": p.confidence,
        "weakestDigit": p.weakest_digit,
        "agreement": p.agreement,
        "detectionConfidence": p.detection_confidence,
        "box": list(p.box),
        "alternatives": p.alternatives,
    } for p in reader.read(frame)]
    result = {"plates": plates, "width": frame.shape[1], "height": frame.shape[0], "ms": round((time.perf_counter() - started) * 1000)}
    if SAVE_FRAMES:
        os.makedirs(SAVE_FRAMES, exist_ok=True)
        name = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        cv2.imwrite(os.path.join(SAVE_FRAMES, f"{name}.jpg"), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
        with open(os.path.join(SAVE_FRAMES, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(result, f)
    return result
