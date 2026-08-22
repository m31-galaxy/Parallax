"""Phase 0: find out what Pioneer's inference API actually returns.

The request shape is documented; the response shape is not. Everything
downstream depends on two unknowns:

  * character offsets - the harness stores start/end per extracted value so a
    proposal can be traced back to the exact span of the note. Without them,
    provenance has to be reconstructed by searching for the string.
  * confidence scores - the post-pass drops low-confidence artefacts using them.

This sends one known paragraph and dumps the raw JSON, unmodified, so we design
against what the API does rather than what we hope it does.

    setx PIONEER_API_KEY "..."        (once, new terminal after)
    uv run --with requests python experiments/distill-harness/probe_pioneer.py

The key is read from the environment and never printed.
"""

import json
import os
import sys
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENDPOINT = "https://api.pioneer.ai/inference"
MODEL_ID = "fastino/gliner2-base-v1"

# Same paragraph the local harness was validated on, so results are comparable
# with experiments/distill-harness/findings.md.
TEXT = (
    "Around 2 we all met up at Victoria Park for Mei's birthday picnic. "
    "Tom brought his dog, Biscuit, who stole half a sandwich."
)

# Mirrors the shape a Parallax class would produce: one structure per class,
# one field per class field, descriptions standing in for field hints.
SCHEMA = {
    "entities": ["person", "location"],
    "structures": {
        "Event": {
            "fields": [
                {"name": "name", "dtype": "str", "description": "Short name of the occasion"},
                {"name": "location", "dtype": "str", "description": "Where it took place"},
                {"name": "people", "dtype": "list", "description": "People who were there"},
                {
                    "name": "kind",
                    "dtype": "str",
                    "choices": ["social", "work", "exercise"],
                    "description": "What sort of event it was",
                },
            ]
        }
    },
}


def call(api_key, payload):
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        body = err.read().decode("utf-8", "replace")
        try:
            return err.code, json.loads(body)
        except json.JSONDecodeError:
            return err.code, {"raw_body": body}


def walk(node, path="$"):
    """Yield (path, key) for every dict key, so we can spot offset/score keys."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield path, key
            yield from walk(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node[:3]):
            yield from walk(value, f"{path}[{index}]")


def main():
    api_key = os.environ.get("PIONEER_API_KEY", "").strip()
    if not api_key:
        print("PIONEER_API_KEY is not set.\n")
        print("PowerShell, this session only:")
        print('    $env:PIONEER_API_KEY = "your-key"')
        print("PowerShell, permanently (reopen the terminal afterwards):")
        print('    setx PIONEER_API_KEY "your-key"')
        return 1

    print(f"POST {ENDPOINT}  model={MODEL_ID}  key={len(api_key)} chars")
    print(f"text: {TEXT[:60]}...\n")

    status, body = call(
        api_key,
        {"model_id": MODEL_ID, "text": TEXT, "schema": SCHEMA, "threshold": 0.5},
    )

    print(f"HTTP {status}")
    print("=" * 70)
    print(json.dumps(body, indent=2, ensure_ascii=False)[:6000])
    print("=" * 70)

    if status != 200:
        print("\nRequest failed. If this is an auth error, check the key; if it is a")
        print("schema error, the request shape in the docs may differ from the live API.")
        return 1

    keys = {key for _, key in walk(body)}
    offset_keys = keys & {"start", "end", "offset", "offsets", "span", "spans", "char_start"}
    score_keys = keys & {"confidence", "score", "scores", "probability", "logit"}

    print("\nWHAT THIS MEANS")
    print("-" * 70)
    print(f"character offsets : {'YES - ' + ', '.join(sorted(offset_keys)) if offset_keys else 'NO'}")
    if not offset_keys:
        print("                    -> provenance must be recovered by searching the note")
        print("                       text for each extracted string (first unclaimed match)")
    print(f"confidence scores : {'YES - ' + ', '.join(sorted(score_keys)) if score_keys else 'NO'}")
    if not score_keys:
        print("                    -> the confidence post-pass cannot run as designed;")
        print("                       'threshold' would have to do the filtering server-side")
    print(f"top-level keys    : {', '.join(sorted(k for p, k in walk(body) if p == '$'))}")

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pioneer_probe.json")
    with open(out, "w", encoding="utf-8") as handle:
        json.dump({"request_schema": SCHEMA, "http_status": status, "response": body},
                  handle, indent=2, ensure_ascii=False)
    print(f"\nraw response saved to {os.path.basename(out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
