"""Explicit public model/test-asset preparation. Never imported by the frame runtime."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import ssl
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
SOURCE = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.pt"
SOURCE_SHA256 = "0ebbc80d4a7680d14987a577cd21342b65ecfd94632bd9a8da63ae6417644ee1"
SAMPLE = "https://raw.githubusercontent.com/ultralytics/assets/main/im/bus.jpg"


def download(url: str, destination: Path, maximum: int) -> bytes:
    import certifi

    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(url, timeout=60, context=context) as response:
        content = response.read(maximum + 1)
    if len(content) > maximum:
        raise RuntimeError("Public setup asset exceeds its bound.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    return content


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--record-lock",
        action="store_true",
        help="Explicitly record the derived model lock for source review",
    )
    args = parser.parse_args()
    for name, value in {
        "YOLO_CONFIG_DIR": str(CACHE / "export-settings"),
        "YOLO_OFFLINE": "true",
        "YOLO_AUTOINSTALL": "false",
        "YOLO_VERBOSE": "false",
        "MPLCONFIGDIR": str(CACHE / "matplotlib"),
    }.items():
        os.environ[name] = value
    for folder in (CACHE / "export-settings", CACHE / "matplotlib"):
        folder.mkdir(parents=True, exist_ok=True)
    source_path = CACHE / "export" / "yolo11n.pt"
    source = (
        source_path.read_bytes()
        if source_path.exists()
        else download(SOURCE, source_path, 8_000_000)
    )
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("Official model checksum mismatch.")
    if not source_path.exists():
        source_path.write_bytes(source)
    # Only public model weights and generated neutral tensors enter this SDK.
    from ultralytics import YOLO, settings

    settings.update(
        {
            key: False
            for key in (
                "sync",
                "clearml",
                "comet",
                "dvc",
                "mlflow",
                "raytune",
                "wandb",
                "tensorboard",
                "neptune",
            )
            if key in settings
        }
    )
    import onnx
    import torch

    torch.set_num_threads(2)
    exported = YOLO(str(source_path), task="detect").export(
        format="onnx",
        imgsz=640,
        batch=1,
        device="cpu",
        opset=12,
        dynamic=False,
        simplify=False,
        half=False,
        nms=False,
        verbose=False,
    )
    model = onnx.load(str(exported))
    model.producer_name = "smartbord-model-preparation"
    model.producer_version = "1"
    model.doc_string = ""
    del model.metadata_props[:]
    onnx.checker.check_model(model)
    encoded = model.SerializeToString(deterministic=True)
    profile = {
        "model": "YOLO11n",
        "source": SOURCE,
        "source_sha256": SOURCE_SHA256,
        "onnx_sha256": hashlib.sha256(encoded).hexdigest(),
        "input_size": 640,
        "output_shape": [1, 84, 8400],
        "opset": 12,
        "license": "https://www.ultralytics.com/license",
        "export_profile": 1,
    }
    lock_path = ROOT / "model-lock.json"
    if args.record_lock:
        lock_path.write_text(json.dumps(profile, indent=2) + "\n", encoding="utf8")
    elif not lock_path.exists() or json.loads(lock_path.read_text()) != profile:
        raise RuntimeError(
            "Derived model differs from the reviewed lock; inspect before recording a new lock."
        )
    target = CACHE / "models" / "yolo11n.onnx"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(encoded)
    sample_path = CACHE / "fixtures" / "bus.jpg"
    sample = download(SAMPLE, sample_path, 1_000_000)
    fixture_profile = {"source": SAMPLE, "sha256": hashlib.sha256(sample).hexdigest()}
    fixture_lock = ROOT / "test-fixture-lock.json"
    if args.record_lock:
        fixture_lock.write_text(
            json.dumps(fixture_profile, indent=2) + "\n", encoding="utf8"
        )
    elif (
        not fixture_lock.exists()
        or json.loads(fixture_lock.read_text()) != fixture_profile
    ):
        raise RuntimeError(
            "Public verification fixture differs from the reviewed lock."
        )
    sample_path.write_bytes(sample)
    (CACHE / "fixtures" / "source.json").write_text(
        json.dumps(
            {"source": SAMPLE, "sha256": hashlib.sha256(sample).hexdigest()}, indent=2
        )
        + "\n"
    )
    print(
        "Public model and positive-test fixture prepared; no lecture content was used."
    )
    print(
        json.dumps(
            {
                "model_sha256": profile["onnx_sha256"],
                "sample_sha256": hashlib.sha256(sample).hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    main()
