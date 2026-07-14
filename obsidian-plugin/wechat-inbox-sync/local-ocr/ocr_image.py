#!/usr/bin/env python3
"""Local image/PDF OCR runtime. Capability: pdf-page-ocr-v1."""

import argparse
import json
import sys
import tempfile
from functools import lru_cache
from pathlib import Path


PDF_DPI = 300


def _box_metrics(box):
    if not isinstance(box, (list, tuple)) or not box:
        return None
    points = [point for point in box if isinstance(point, (list, tuple)) and len(point) >= 2]
    if not points:
        return None
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return {
        "left": min(xs),
        "top": min(ys),
        "center_y": (min(ys) + max(ys)) / 2,
        "height": max(1.0, max(ys) - min(ys)),
    }


def _result_entries(value):
    if value is None:
        return []
    if hasattr(value, "txts"):
        texts = list(getattr(value, "txts", []) or [])
        boxes = list(getattr(value, "boxes", []) or [])
        return [
            {"text": str(text).strip(), "box": boxes[index] if index < len(boxes) else None}
            for index, text in enumerate(texts)
            if str(text).strip()
        ]
    if isinstance(value, tuple) and value:
        return _result_entries(value[0])
    if not isinstance(value, list):
        return []

    entries = []
    for item in value:
        if item is None:
            continue
        text = ""
        box = None
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict):
            text = str(item.get("text") or item.get("rec_text") or item.get("txt") or "").strip()
            box = item.get("box") or item.get("dt_box") or item.get("points")
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            box = item[0]
            text = str(item[1]).strip()
        if text:
            entries.append({"text": text, "box": box})
    return entries


def _sort_entries_for_reading(entries):
    positioned = []
    unpositioned = []
    for index, entry in enumerate(entries):
        metrics = _box_metrics(entry.get("box"))
        item = {**entry, "index": index, "metrics": metrics}
        if metrics:
            positioned.append(item)
        else:
            unpositioned.append(item)

    positioned.sort(key=lambda item: (item["metrics"]["top"], item["metrics"]["left"]))
    rows = []
    for item in positioned:
        metrics = item["metrics"]
        target = None
        for row in reversed(rows[-3:]):
            tolerance = max(8.0, min(row["height"], metrics["height"]) * 0.65)
            if abs(metrics["center_y"] - row["center_y"]) <= tolerance:
                target = row
                break
        if target is None:
            rows.append({
                "center_y": metrics["center_y"],
                "height": metrics["height"],
                "items": [item],
            })
        else:
            target["items"].append(item)
            count = len(target["items"])
            target["center_y"] = ((target["center_y"] * (count - 1)) + metrics["center_y"]) / count
            target["height"] = max(target["height"], metrics["height"])

    ordered = []
    for row in sorted(rows, key=lambda item: item["center_y"]):
        ordered.extend(sorted(row["items"], key=lambda item: item["metrics"]["left"]))
    ordered.extend(unpositioned)
    return [item["text"] for item in ordered if item["text"]]


def flatten_rapidocr_result(value):
    return _sort_entries_for_reading(_result_entries(value))


@lru_cache(maxsize=1)
def _get_simplified_chinese_converter():
    from opencc import OpenCC

    return OpenCC("t2s")


def _simplify_text(text):
    return _get_simplified_chinese_converter().convert(str(text or ""))


def _create_engine():
    try:
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        from rapidocr import RapidOCR
    return RapidOCR()


def _ocr_image(engine, image_path):
    result = engine(str(image_path))
    return [_simplify_text(text).strip() for text in flatten_rapidocr_result(result) if text.strip()]


def _ocr_pdf(engine, pdf_path):
    import fitz

    document = fitz.open(str(pdf_path))
    page_results = []
    try:
        scale = PDF_DPI / 72.0
        matrix = fitz.Matrix(scale, scale)
        with tempfile.TemporaryDirectory(prefix="wechat-inbox-pdf-ocr-") as temp_dir:
            for page_index in range(document.page_count):
                page = document.load_page(page_index)
                image_path = Path(temp_dir) / f"page-{page_index + 1:04d}.png"
                page.get_pixmap(matrix=matrix, alpha=False).save(str(image_path))
                try:
                    lines = _ocr_image(engine, image_path)
                    page_results.append({"page": page_index + 1, "lines": lines, "error": ""})
                except Exception as error:
                    page_results.append({"page": page_index + 1, "lines": [], "error": str(error)})
    finally:
        document.close()

    if not any(item["lines"] for item in page_results):
        errors = "; ".join(item["error"] for item in page_results if item["error"])
        raise RuntimeError(f"PDF OCR did not extract readable text{': ' + errors if errors else ''}")

    markdown_parts = []
    all_lines = []
    for item in page_results:
        markdown_parts.append(f"## 第 {item['page']} 页")
        if item["lines"]:
            markdown_parts.append("\n".join(item["lines"]))
            all_lines.extend(item["lines"])
        else:
            markdown_parts.append(f"> 本页 OCR 失败：{item['error'] or '未识别到文字'}")
    return "\n\n".join(markdown_parts).strip(), all_lines, page_results


def main():
    parser = argparse.ArgumentParser(description="Run local OCR for one image or PDF.")
    parser.add_argument("--input", required=True, help="Input image or PDF path")
    parser.add_argument("--output", required=True, help="Output text path")
    parser.add_argument("--json", action="store_true", help="Write JSON result instead of plain text")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"input file not found: {input_path}")

    engine = _create_engine()
    page_results = []
    if input_path.suffix.lower() == ".pdf":
        text, lines, page_results = _ocr_pdf(engine, input_path)
    else:
        lines = _ocr_image(engine, input_path)
        text = "\n".join(lines).strip()

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.json:
        output_path.write_text(json.dumps({
            "text": text,
            "lines": lines,
            "pages": page_results,
        }, ensure_ascii=False), encoding="utf-8")
    else:
        output_path.write_text(text, encoding="utf-8")
    print(f"LOCAL_OCR_OK: {len(lines)} lines", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"LOCAL_OCR_ERROR: {error}", file=sys.stderr)
        sys.exit(1)
