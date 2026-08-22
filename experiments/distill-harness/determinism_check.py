"""Is GLiNER2 reproducible across processes?

The sponsor analysis lists GLiNER2 as deterministic on the grounds that it is an
encoder, not a generative model. This measures that claim directly.

Each trial runs in a FRESH SUBPROCESS - loading the weights again from scratch -
because within one process the model is loaded once and any per-load variation is
invisible. Every trial pins the seed, single-threads torch, and enables
deterministic algorithms, so an unstable result cannot be blamed on RNG or on
thread scheduling.

Two tasks are compared:
  * structured extraction (extract_json)   - what distillation uses
  * entity extraction     (extract_entities) - the simpler NER head

    uv run --with "gliner2[local]" python determinism_check.py [trials]

Writes determinism_log.txt (full transcript) and determinism.json (raw trials).
No database required.
"""

import hashlib
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).parent
JOURNAL = HERE / "journal.txt"
LOG = HERE / "determinism_log.txt"
DATA = HERE / "determinism.json"

MODEL_ID = "fastino/gliner2-base-v1"
ENTITY_LABELS = {
    "person": "Names or references to people, including nicknames and family roles",
    "event": "A planned or happening occasion such as a picnic, defence, dinner or meeting",
    "location": "A place: cafe, park, library, gym, street, city, country, or home",
}
EVENT_SCHEMA = {
    "event": [
        "name::str::Short name of the activity or occasion, e.g. breakfast, picnic, climbing",
        "location::str::The place where it happened",
        "people::list::Names of people present",
        "time::str::Clock time or day it happened",
    ]
}


# --- worker: one trial, one fresh process -----------------------------------


def worker():
    import torch

    torch.manual_seed(0)
    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True, warn_only=True)

    from gliner2 import GLiNER2

    content = JOURNAL.read_text(encoding="utf-8")
    model = GLiNER2.from_pretrained(MODEL_ID)

    structured = []
    for para in [p.strip() for p in content.split("\n\n") if p.strip()]:
        out = model.extract_json(
            para, EVENT_SCHEMA, include_confidence=True, include_spans=True
        )
        for obj in out.get("event", []):
            name = obj.get("name")
            if not name:
                continue
            structured.append(
                {
                    "name": name["text"],
                    "confidence": round(float(name["confidence"]), 6),
                    "location": (obj.get("location") or {}).get("text"),
                }
            )

    ents = model.extract_entities(
        content, ENTITY_LABELS, include_confidence=True, include_spans=True
    )
    entities = sorted(
        (label, e["text"], round(float(e["confidence"]), 6))
        for label, items in ents.get("entities", ents).items()
        for e in items
    )

    print("@@RESULT@@" + json.dumps(
        {
            "content_sha": hashlib.sha256(content.encode()).hexdigest()[:16],
            "torch": torch.__version__,
            "structured": structured,
            "entities": entities,
        }
    ))


# --- driver -----------------------------------------------------------------


def signature(obj):
    return hashlib.sha256(
        json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()[:12]


def names_only(structured):
    return sorted(item["name"] for item in structured)


def main(trials):
    lines = []

    def say(text=""):
        print(text)
        lines.append(text)

    say("GLiNER2 cross-process determinism check")
    say(f"model   : {MODEL_ID}")
    say(f"trials  : {trials} (each a fresh subprocess, weights reloaded)")
    say("controls: torch.manual_seed(0), set_num_threads(1), "
        "use_deterministic_algorithms(True)")
    say("=" * 78)
    content = JOURNAL.read_text(encoding="utf-8")
    say("INPUT (journal.txt, verbatim):")
    say("-" * 78)
    for line in content.splitlines():
        say("| " + line)
    say("-" * 78)

    results = []
    for trial in range(1, trials + 1):
        proc = subprocess.run(
            [sys.executable, str(Path(__file__)), "--worker"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        payload = next(
            (ln[len("@@RESULT@@"):] for ln in proc.stdout.splitlines()
             if ln.startswith("@@RESULT@@")),
            None,
        )
        if payload is None:
            say(f"trial {trial}: FAILED\n{proc.stdout[-500:]}\n{proc.stderr[-500:]}")
            continue

        result = json.loads(payload)
        results.append(result)

        say(f"\ntrial {trial}  input sha={result['content_sha']}  "
            f"torch={result['torch']}")
        say(f"  structured  sig={signature(result['structured'])}  "
            f"({len(result['structured'])} objects)")
        for item in result["structured"]:
            say(f"      {item['confidence']:.6f}  {item['name']!r}"
                f"  loc={item['location']!r}")
        say(f"  entities    sig={signature(result['entities'])}  "
            f"({len(result['entities'])} spans)")

    if not results:
        say("\nno trials completed")
        return 1

    say("\n" + "=" * 78)
    say("VERDICT")
    say("=" * 78)

    shas = {r["content_sha"] for r in results}
    say(f"input identical across trials : {len(shas) == 1}  {shas}")

    struct_sigs = Counter(signature(r["structured"]) for r in results)
    ent_sigs = Counter(signature(r["entities"]) for r in results)
    name_sigs = Counter(signature(names_only(r["structured"])) for r in results)

    say(f"structured extraction  : {len(struct_sigs)} distinct results "
        f"in {len(results)} trials -> "
        f"{'DETERMINISTIC' if len(struct_sigs) == 1 else 'NOT DETERMINISTIC'}")
    say(f"   ...ignoring scores  : {len(name_sigs)} distinct object sets -> "
        f"{'stable' if len(name_sigs) == 1 else 'THE SET OF OBJECTS CHANGES'}")
    say(f"entity extraction      : {len(ent_sigs)} distinct results "
        f"in {len(results)} trials -> "
        f"{'DETERMINISTIC' if len(ent_sigs) == 1 else 'NOT DETERMINISTIC'}")

    # Which objects are stable, and which flicker?
    appearances = Counter()
    for result in results:
        for name in set(names_only(result["structured"])):
            appearances[name] += 1

    say("\nper-object stability (appearances / trials):")
    for name, count in appearances.most_common():
        scores = [
            item["confidence"]
            for r in results for item in r["structured"] if item["name"] == name
        ]
        band = f"{min(scores):.3f}-{max(scores):.3f}" if scores else "-"
        flag = "stable" if count == len(results) else "FLICKERS"
        say(f"  {count}/{len(results)}  {flag:<8}  conf {band:<14} {name!r}")

    DATA.write_text(
        json.dumps({"model": MODEL_ID, "trials": results}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")
    say(f"\nwrote {LOG.name} and {DATA.name}")
    return 0


if __name__ == "__main__":
    if "--worker" in sys.argv:
        worker()
    else:
        count = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 6
        sys.exit(main(count))
