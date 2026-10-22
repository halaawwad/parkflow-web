# SmartGate plate recognition (ALPR)

A small Python service that reads license plates from camera frames using
[FastALPR](https://github.com/ankandrew/fast-alpr) pretrained ONNX models —
no training. The ParkFlow API calls it from `POST /api/v1/gate/recognize`;
the app never talks to it directly.

- Detector: `yolo-v9-t-384-license-plate-end2end` (open-image-models)
- OCR: `cct-xs-v2-global-model`, with `cct-s-v2-global-model` consulted when the
  small model is not decisive (fast-plate-ocr, multi-country)

`plate_reader.py` adds what a gate needs on top of the models:

- **Digit-only decoding.** Palestinian and Israeli plates are numeric, so each
  character slot takes its best digit. An 8 that looks like a `B` stays an 8 with a
  lower confidence instead of being dropped (which used to shorten the number).
- **Several crops, one vote.** Tight, padded and contrast-boosted crops are read and
  voted on, so a one-off misread (such as the bar before `ف/P` read as a trailing 1)
  loses to the consensus.
- **Never accepts an incomplete reading.** A plate is returned as `complete` only when
  it has 6–8 digits (ParkFlow's formats), is not touching the frame edge (possibly cut
  off), is at least 120 px wide, the crops agree, and every digit is confident.
  Otherwise it comes back as uncertain with a reason; nothing is padded or guessed.
- **The nearest car.** The largest plate is reported first; the API uses only that one.

The app also requires the same complete number in two camera frames before showing
it, and the operator always confirms (and can correct) before entry or exit.

On 20 real plate photos (Palestinian, Israeli 7- and 8-digit, plus three plates outside
ParkFlow's formats) at original, 1280 px and 800 px sizes, the previous reader accepted
16 wrong numbers out of 47 frames; this one accepted none, and withheld the frames it
was unsure of (mostly close-ups where the plate touches the frame edge).

## Run locally (Python 3.10–3.12)

```bash
cd server/alpr
python -m venv .venv
.venv/Scripts/activate        # Windows; use `source .venv/bin/activate` elsewhere
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8090
```

The first start downloads the models (~30 MB). Then set in `server/.env`:

```
ALPR_URL=http://127.0.0.1:8090
```

Check it: `curl -X POST --data-binary @plate.jpg -H "Content-Type: image/jpeg" http://127.0.0.1:8090/recognize`

## Docker

`docker compose up alpr` (from `server/`) builds and runs it on port 8090;
the backend container reaches it at `http://alpr:8090`.

## Settings

| Variable | Default |
| --- | --- |
| `ALPR_DETECTOR_MODEL` | `yolo-v9-t-384-license-plate-end2end` |
| `ALPR_OCR_MODELS` | `cct-xs-v2-global-model,cct-s-v2-global-model` (first reads every plate, the rest only when it is unsure) |
| `ALPR_DETECTOR_CONF` | `0.3` |
| `ALPR_SAVE_FRAMES` | empty. Local testing only: a folder where each frame and its result are saved |
| `ALPR_TOKEN` | empty — when set, the API must send the same value (`ALPR_TOKEN` in `server/.env`) |

## Testing on your own camera frames

1. Start the service with `ALPR_SAVE_FRAMES=./frames` and scan plates in SmartGate.
2. Rename each saved `.jpg` to start with its true digits, e.g. `66778999_gate.jpg`
   (use `0_` for frames with no ParkFlow plate).
3. `python evaluate.py ./frames` — prints correct / wrong / uncertain; `wrong` must be 0.

Delete the folder afterwards: the frames show real plates.
