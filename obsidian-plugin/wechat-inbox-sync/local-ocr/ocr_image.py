#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def flatten_rapidocr_result(value):
    if value is None:
        return []
    if hasattr(value, "txts"):
        return [str(item).strip() for item in getattr(value, "txts", []) if str(item).strip()]
    if isinstance(value, tuple) and value:
        return flatten_rapidocr_result(value[0])
    if isinstance(value, list):
        texts = []
        for item in value:
            if item is None:
                continue
            if isinstance(item, str):
                text = item.strip()
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                text = str(item[1]).strip()
            elif isinstance(item, dict):
                text = str(item.get("text") or item.get("rec_text") or item.get("txt") or "").strip()
            else:
                text = str(item).strip()
            if text:
                texts.append(text)
        return texts
    return []


def main():
    parser = argparse.ArgumentParser(description="Run local OCR for one image.")
    parser.add_argument("--input", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output text path")
    parser.add_argument("--json", action="store_true", help="Write JSON result instead of plain text")
    args = parser.parse_args()

    image_path = Path(args.input)
    if not image_path.exists():
        raise FileNotFoundError(f"input image not found: {image_path}")

    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        from rapidocr import RapidOCR

    engine = RapidOCR()
    result = engine(str(image_path))
    texts = flatten_rapidocr_result(result)
    text = "\n".join(texts).strip()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.json:
        output_path.write_text(json.dumps({"text": text, "lines": texts}, ensure_ascii=False), encoding="utf-8")
    else:
        output_path.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"LOCAL_OCR_ERROR: {error}", file=sys.stderr)
        sys.exit(1)
