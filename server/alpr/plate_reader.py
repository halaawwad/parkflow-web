"""
Plate reading tuned for Palestinian and Israeli plates, which are digits only.

FastALPR finds the plate and its pretrained OCR models read it; this module
adds what a gate needs on top:

- Digit-only decoding. The OCR model scores every character slot over digits,
  letters and a padding symbol. Plates here are numeric, so each slot takes its
  best digit (or ends the plate). An 8 that looks like a "B" stays an 8 with an
  honestly lower confidence, instead of being dropped and shortening the number.
- Several crops of each plate (tight, padded, contrast-boosted), then a vote. A
  misread that only one crop produces, such as the bar before the "P" read as a
  trailing 1, loses to the consensus. The small OCR model reads first; the larger
  one is only consulted when the small one is not decisive, which keeps clear
  plates fast.
- The car at the gate is the one with the largest plate. A plate further away is
  never offered in its place, even when it reads better.
- Nothing is invented or padded. A plate cut off by the frame edge, a reading
  outside ParkFlow's 6–8 digit formats, or a weak vote is returned as uncertain,
  never as the plate number.
"""

from collections import defaultdict
from dataclasses import dataclass, field

import cv2
import numpy as np
from fast_alpr import ALPR
from fast_plate_ocr import LicensePlateRecognizer
from fast_plate_ocr.core.process import preprocess_image
from fast_plate_ocr.inference.plate_recognizer import _load_image_from_source

# ParkFlow plate formats: Palestinian 7 digits (9-1019-90), Israeli 7 or 8
# (27-644-72, 716-62-601) and older 6-digit plates.
MIN_DIGITS, MAX_DIGITS = 6, 8
# A plate box this close to the frame edge may be cut off.
EDGE_MARGIN = 0.01
# Below this width (pixels) the OCR starts dropping digits; ask the operator to come closer.
MIN_PLATE_WIDTH = 120
# Acceptance: share of readings that agree, their mean digit confidence, and
# the weakest digit's confidence.
MIN_AGREEMENT = 0.5
MIN_CONFIDENCE = 0.75
MIN_DIGIT_CONFIDENCE = 0.45
# The small model alone is enough when every crop agrees this firmly.
DECISIVE_CONFIDENCE, DECISIVE_DIGIT = 0.9, 0.6
# (horizontal, vertical) padding around the detector's box, as a share of its size.
CROP_PADDING = ((0.0, 0.0), (0.06, 0.12), (0.12, 0.2))


@dataclass
class Reading:
    digits: str
    probs: list[float]

    @property
    def confidence(self) -> float:
        return float(np.mean(self.probs)) if self.probs else 0.0

    @property
    def weakest(self) -> float:
        return float(min(self.probs)) if self.probs else 0.0


@dataclass
class PlateResult:
    box: tuple[int, int, int, int]
    detection_confidence: float
    digits: str | None = None
    confidence: float = 0.0
    weakest_digit: float = 0.0
    agreement: float = 0.0
    complete: bool = False
    reason: str | None = None
    alternatives: list[dict] = field(default_factory=list)


class PlateReader:
    def __init__(self, detector_model: str, ocr_models: list[str], detector_conf: float):
        alpr = ALPR(detector_model=detector_model, ocr_model=ocr_models[0], detector_conf_thresh=detector_conf,
                    detector_providers=["CPUExecutionProvider"], ocr_device="cpu")
        self.detector = alpr.detector
        self.recognizers = [alpr.ocr.ocr_model] + [LicensePlateRecognizer(m, device="cpu") for m in ocr_models[1:]]

    # ── Detection ────────────────────────────────────────────────────────

    def _detect(self, frame: np.ndarray):
        # A plate that fills the whole view touches the frame edge and is treated as cut
        # off anyway, so there is no second, padded detection pass.
        return [(d.bounding_box, float(d.confidence)) for d in self.detector.predict(frame)]

    @staticmethod
    def _crops(frame: np.ndarray, box) -> list[np.ndarray]:
        h, w = frame.shape[:2]
        crops = []
        for px, py in CROP_PADDING:
            dx, dy = (box.x2 - box.x1) * px, (box.y2 - box.y1) * py
            crop = frame[max(0, int(box.y1 - dy)):min(h, int(box.y2 + dy)), max(0, int(box.x1 - dx)):min(w, int(box.x2 + dx))]
            if crop.size:
                crops.append(crop)
        if len(crops) > 1:
            # Low light and glare: equalise the lightness of the padded crop.
            lab = cv2.cvtColor(crops[1], cv2.COLOR_BGR2LAB)
            lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(4, 4)).apply(lab[:, :, 0])
            crops.append(cv2.cvtColor(lab, cv2.COLOR_LAB2BGR))
        return crops

    # ── OCR with digit-only decoding ────────────────────────────────────

    @staticmethod
    def _decode(slots: np.ndarray, alphabet: str, pad_char: str) -> Reading:
        digit_idx = [alphabet.index(c) for c in "0123456789"]
        pad_idx = alphabet.index(pad_char)
        digits, probs = [], []
        for slot in slots:
            best = max(digit_idx, key=lambda i: slot[i])
            if slot[pad_idx] >= slot[best]:
                break  # The plate ends here; nothing after the padding is read.
            digits.append(alphabet[best])
            probs.append(float(slot[best]))
        return Reading("".join(digits), probs)

    def _run(self, recognizer, crops: list[np.ndarray]) -> list[Reading]:
        cfg = recognizer.config
        rgb = [cv2.cvtColor(c, cv2.COLOR_BGR2RGB) for c in crops]
        x = preprocess_image(_load_image_from_source(rgb, cfg))
        out = recognizer.model.run([recognizer.plate_output_name], {"input": x})[0]
        out = out.reshape(len(crops), cfg.max_plate_slots, len(cfg.alphabet))
        return [self._decode(slots, cfg.alphabet, cfg.pad_char) for slots in out]

    def _read(self, crops: list[np.ndarray]) -> list[Reading]:
        readings = self._run(self.recognizers[0], crops)
        first = readings[0].digits
        decisive = (bool(first) and all(r.digits == first for r in readings)
                    and min(r.confidence for r in readings) >= DECISIVE_CONFIDENCE
                    and min(r.weakest for r in readings) >= DECISIVE_DIGIT)
        if not decisive:
            for recognizer in self.recognizers[1:]:
                readings += self._run(recognizer, crops)
        return readings

    # ── Vote and decide ─────────────────────────────────────────────────

    @staticmethod
    def _vote(readings: list[Reading]):
        groups: dict[str, list[Reading]] = defaultdict(list)
        for r in readings:
            if r.digits:
                groups[r.digits].append(r)
        ranked = sorted(groups.items(), key=lambda kv: sum(r.confidence for r in kv[1]), reverse=True)
        return ranked

    def read(self, frame: np.ndarray) -> list[PlateResult]:
        h, w = frame.shape[:2]
        results = []
        for box, det_conf in self._detect(frame):
            result = PlateResult(box=(int(box.x1), int(box.y1), int(box.x2), int(box.y2)), detection_confidence=round(det_conf, 3))
            readings = self._read(self._crops(frame, box))
            ranked = self._vote(readings)
            if not ranked:
                result.reason = "unreadable"
                results.append(result)
                continue
            digits, group = ranked[0]
            result.digits = digits
            result.agreement = round(len(group) / len(readings), 2)
            result.confidence = round(float(np.mean([r.confidence for r in group])), 3)
            result.weakest_digit = round(float(np.mean([r.weakest for r in group])), 3)
            result.alternatives = [{"digits": d, "votes": len(g)} for d, g in ranked[1:4]]
            edge = (box.x1 <= w * EDGE_MARGIN or box.y1 <= h * EDGE_MARGIN or box.x2 >= w * (1 - EDGE_MARGIN) or box.y2 >= h * (1 - EDGE_MARGIN))
            if edge:
                result.reason = "cut_off"
            elif box.x2 - box.x1 < MIN_PLATE_WIDTH:
                result.reason = "too_small"
            elif not MIN_DIGITS <= len(digits) <= MAX_DIGITS:
                result.reason = "wrong_length"
            elif result.agreement < MIN_AGREEMENT:
                result.reason = "disagreement"
            elif result.confidence < MIN_CONFIDENCE or result.weakest_digit < MIN_DIGIT_CONFIDENCE:
                result.reason = "low_confidence"
            else:
                result.complete = True
            results.append(result)
        # Largest plate first: that is the car at the gate, whatever its reading.
        results.sort(key=lambda r: (r.box[2] - r.box[0]) * (r.box[3] - r.box[1]), reverse=True)
        return results
