#!/usr/bin/env python3
"""
fill_build_prompt.py — Fill New-4-Code's build prompt from the audit's
machine-readable constraints block in New-1-Concept.

Pipeline: New-3 (auditor) writes a YAML block, wrapped in
<!-- PIPELINE-CONSTRAINTS:BEGIN --> / :END --> sentinels, into the
`### AI Audit` section of New-1-Concept.md. This script reads that block and
substitutes the four [PASTE ...] markers in the New-4-Code.md template,
writing a ready-to-send New-4-Code.filled.md. The template is never modified.

Usage:
    python3 fill_build_prompt.py \
        --concept New-1-Concept.md \
        --template New-4-Code.md \
        --out New-4-Code.filled.md

Requires PyYAML:  pip install pyyaml   (or: pip install --break-system-packages pyyaml)
"""

import argparse
import re
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML not found. Install it with:  pip install pyyaml")

BEGIN = "<!-- PIPELINE-CONSTRAINTS:BEGIN -->"
END = "<!-- PIPELINE-CONSTRAINTS:END -->"

# YAML key -> the marker text in the New-4 template it should replace.
MARKERS = {
    "hurdles": "[PASTE §2 HIGH-RISK TECHNICAL HURDLES]",
    "builder_constraints": "[PASTE §4 BUILDER CONSTRAINTS]",
    "deterministic_tests": "[PASTE §4 DETERMINISTIC TEST REQUIREMENTS]",
    "reviewer_criteria": "[PASTE §4 REVIEWER CRITERIA]",
}

# Recommendations that should stop the build rather than fill the prompt.
BLOCKING = {"defer", "kill"}


def extract_yaml_block(text):
    """Pull the sentinel-wrapped YAML out of the concept file."""
    occurrences = text.count(BEGIN)
    if occurrences == 0:
        sys.exit(
            "No PIPELINE-CONSTRAINTS block found. Has the audit (New-3) run and "
            "written its machine-readable block into ### AI Audit?"
        )
    if occurrences > 1:
        sys.exit(f"Found {occurrences} PIPELINE-CONSTRAINTS blocks; expected exactly 1.")

    block = text.split(BEGIN, 1)[1].split(END, 1)[0]
    # Strip the ```yaml fences if present.
    block = re.sub(r"^\s*```(?:yaml)?\s*$", "", block, flags=re.MULTILINE)
    return block.strip()


def validate(data):
    """Confirm the parsed YAML has the shape we expect before substituting."""
    if not isinstance(data, dict):
        sys.exit("Constraints block did not parse to a YAML mapping.")
    missing = [k for k in MARKERS if k not in data]
    if missing:
        sys.exit(f"Constraints block is missing required keys: {', '.join(missing)}")
    for k in MARKERS:
        if not isinstance(data[k], list) or not all(isinstance(x, str) for x in data[k]):
            sys.exit(f"Key '{k}' must be a YAML list of strings.")
        if not data[k]:
            print(f"  warning: '{k}' is empty — the audit produced no items for it.", file=sys.stderr)


def render_bullets(items):
    return "\n".join(f"- {item}" for item in items) if items else "_(none specified by the audit)_"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--concept", default="New-1-Concept.md", help="path to the filled concept doc")
    ap.add_argument("--template", default="New-4-Code.md", help="path to the New-4 build-prompt template")
    ap.add_argument("--out", default="New-4-Code.filled.md", help="output path for the filled prompt")
    ap.add_argument("--force", action="store_true", help="fill even if recommendation is Defer/Kill")
    args = ap.parse_args()

    with open(args.concept, encoding="utf-8") as f:
        concept_text = f.read()
    with open(args.template, encoding="utf-8") as f:
        template = f.read()

    data = yaml.safe_load(extract_yaml_block(concept_text))
    validate(data)

    rec = str(data.get("recommendation", "")).strip()
    if any(b in rec.lower() for b in BLOCKING) and not args.force:
        sys.exit(
            f"Audit recommendation is '{rec}'. Not generating a build prompt. "
            f"Re-run with --force to override."
        )

    filled = template
    for key, marker in MARKERS.items():
        if marker not in filled:
            sys.exit(f"Template marker not found: {marker}")
        filled = filled.replace(marker, render_bullets(data[key]))

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(filled)

    counts = ", ".join(f"{k}={len(data[k])}" for k in MARKERS)
    print(f"Wrote {args.out}  (recommendation: {rec or 'n/a'})")
    print(f"  filled: {counts}")
    remaining = filled.count("[PASTE")
    if remaining:
        print(f"  note: {remaining} other [PASTE ...] marker(s) remain (e.g. Standing Build Conventions) — fill by hand.", file=sys.stderr)


if __name__ == "__main__":
    main()
