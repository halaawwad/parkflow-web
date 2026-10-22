"""
Check plate reading on your own camera frames.

1. Run the service with ALPR_SAVE_FRAMES=./frames and scan some plates in SmartGate.
2. Rename each saved .jpg to start with its true plate digits, e.g. 66778999_gate.jpg.
   Use 0_ for frames with no readable ParkFlow plate (nothing should be accepted).
3. python evaluate.py ./frames

"wrong" must stay at 0: a wrong number accepted is worse than asking the operator.
"""

import glob
import os
import sys

import cv2

from app import DETECTOR_CONF, DETECTOR_MODEL, OCR_MODELS
from plate_reader import PlateReader


def main(folder: str) -> int:
    reader = PlateReader(DETECTOR_MODEL, OCR_MODELS, DETECTOR_CONF)
    tally = {"correct": 0, "wrong": 0, "uncertain": 0}
    for path in sorted(glob.glob(os.path.join(folder, "*.jpg")) + glob.glob(os.path.join(folder, "*.png"))):
        truth = os.path.basename(path).split("_")[0]
        frame = cv2.imread(path)
        if frame is None or not truth.isdigit():
            continue
        plates = reader.read(frame)
        primary = plates[0] if plates else None
        accepted = primary.digits if primary and primary.complete else None
        kind = "uncertain" if accepted is None else "correct" if accepted == truth else "wrong"
        tally[kind] += 1
        detail = f"{primary.digits} ({primary.reason or 'complete'}, conf {primary.confidence}, weakest {primary.weakest_digit})" if primary else "no plate"
        print(f"{kind:9} {os.path.basename(path)}: {detail}")
    print(tally)
    return 1 if tally["wrong"] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "frames"))
