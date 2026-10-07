#!/usr/bin/env python3
"""Fail-closed coverage assertion for the public repeated-JFK ASR fixture."""

import argparse
import json
import re
from pathlib import Path


def normalized(value):
    return re.sub(r"\s+", " ", value or "").strip().lower()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--transcript", required=True, type=Path)
    parser.add_argument("--meta", required=True, type=Path)
    parser.add_argument("--expected-text", default="ask not what your country can do for you")
    parser.add_argument("--expected-count", required=True, type=int)
    args = parser.parse_args()

    report = json.loads(args.report.read_text(encoding="utf-8"))
    cases = report.get("cases")
    if not isinstance(cases, list) or len(cases) != 1:
        raise SystemExit("long ASR coverage requires exactly one recorded variant")
    case = cases[0]
    if case.get("exit_code") != 0 or case.get("timed_out") is not False:
        raise SystemExit("long ASR coverage requires exitCode=0 and timedOut=false")
    if case.get("passed") is not True or case.get("transcript_nonempty") is not True:
        raise SystemExit("long ASR coverage requires a passing non-empty transcript")

    meta = {}
    for line in args.meta.read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            meta[key] = value
    duration = float(meta.get("durationSeconds", "0"))
    if duration < 120:
        raise SystemExit("long ASR coverage fixture is shorter than 120 seconds")

    text = normalized(args.transcript.read_text(encoding="utf-8", errors="replace"))
    phrase = normalized(args.expected_text)
    count = text.count(phrase)
    if count != args.expected_count:
        raise SystemExit(
            f"long ASR coverage expected phrase count={args.expected_count}, actual={count}"
        )

    print(
        "label={label} exitCode={exit_code} timedOut={timed_out} "
        "durationSeconds={duration:.3f} expectedCount={expected} actualCount={actual} "
        "transcriptNonempty={nonempty}".format(
            label=case.get("label", "unknown"),
            exit_code=case.get("exit_code"),
            timed_out=case.get("timed_out"),
            duration=duration,
            expected=args.expected_count,
            actual=count,
            nonempty=case.get("transcript_nonempty"),
        )
    )


if __name__ == "__main__":
    main()
