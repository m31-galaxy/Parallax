"""Extraction backends: local GLiNER2 weights, or Pioneer's hosted API.

Both return the same shape, so the rest of the pipeline does not care which ran:

    {"<ClassName>": [ {field: {"text", "confidence", "start", "end"}, ...}, ... ]}

`start`/`end` are offsets into the text that was passed in. The local model
reports them directly. Pioneer's response shape is undocumented, so the API
backend recovers them by locating each returned string in the source text -
see `_attach_spans`.

Choose with PARALLAX_EXTRACTOR=local|pioneer (default: local, because it is
free, offline, and known to return offsets and confidences).
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

MODEL_ID = "fastino/gliner2-base-v1"
PIONEER_ENDPOINT = "https://api.pioneer.ai/inference"
DEFAULT_THRESHOLD = 0.5


def load_dotenv():
    """Load KEY=VALUE lines from the repo-root .env into os.environ, without a
    dependency. Real environment variables win, so `setx`/`$env:` still override.
    The file is gitignored; see .env.example for the format.
    """
    # extractor.py -> distill-harness -> experiments -> repo root
    root = Path(__file__).resolve().parents[2]
    env_file = root / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("\"'")
        os.environ.setdefault(key, value)


load_dotenv()


class ExtractionError(RuntimeError):
    """Raised with the backend's own message, unaltered (spec section 3)."""


# --- local ------------------------------------------------------------------


class LocalExtractor:
    """GLiNER2 running on this machine. Returns real character offsets."""

    name = "local"

    def __init__(self, model_id: str = MODEL_ID):
        from gliner2 import GLiNER2

        self.model_id = model_id
        self._model = GLiNER2.from_pretrained(model_id)

    def extract(self, text: str, structures: dict, threshold: float = DEFAULT_THRESHOLD):
        """structures: {ClassName: [ "field::dtype::description", ... ]}"""
        out = self._model.extract_json(
            text, structures, include_confidence=True, include_spans=True
        )
        return {name: objects for name, objects in out.items() if objects}


# --- pioneer ----------------------------------------------------------------


class PioneerExtractor:
    """Pioneer's hosted GLiNER2.

    Requires PIONEER_API_KEY. Note that inference is separately gated by
    billing: a valid key can still return 403 payment_method_required, which
    means the account cannot run inference yet - not that the key is wrong.
    """

    name = "pioneer"

    def __init__(self, model_id: str = MODEL_ID, api_key: str | None = None):
        self.model_id = model_id
        self.api_key = (api_key or os.environ.get("PIONEER_API_KEY", "")).strip()
        if not self.api_key:
            raise ExtractionError(
                "PIONEER_API_KEY is not set. In PowerShell: $env:PIONEER_API_KEY = '...'"
            )

    def extract(self, text: str, structures: dict, threshold: float = DEFAULT_THRESHOLD):
        payload = {
            "model_id": self.model_id,
            "text": text,
            "schema": {"structures": _to_api_structures(structures)},
            "threshold": threshold,
        }
        request = urllib.request.Request(
            PIONEER_ENDPOINT,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-API-Key": self.api_key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "replace")
            raise ExtractionError(f"Pioneer HTTP {err.code}: {detail}") from err
        except urllib.error.URLError as err:
            raise ExtractionError(f"Pioneer unreachable: {err.reason}") from err

        # Keep only the classes we asked for: the response's `data` can also
        # carry an `entities` block, which is not a user class.
        wanted = set(structures)
        normalised = {
            name: objects
            for name, objects in _normalise_api_response(body).items()
            if name in wanted
        }
        # Pioneer's structured task returns text + confidence but NO offsets
        # (only its entities task does), so _attach_spans recovers them by
        # locating each value in the source text.
        return _attach_spans(normalised, text)


# --- shared -------------------------------------------------------------


def _parse_field_spec(spec: str) -> dict:
    """"name::dtype::description" -> the API's field object."""
    parts = spec.split("::")
    field = {"name": parts[0], "dtype": parts[1] if len(parts) > 1 else "str"}
    if len(parts) > 2 and parts[2]:
        field["description"] = parts[2]
    # "field::[a|b]::str" is the local library's choices syntax.
    if field["dtype"].startswith("[") and field["dtype"].endswith("]"):
        field["choices"] = field["dtype"][1:-1].split("|")
        field["dtype"] = "str"
    return field


def _to_api_structures(structures: dict) -> dict:
    return {
        name: {"fields": [_parse_field_spec(spec) for spec in specs]}
        for name, specs in structures.items()
    }


def _normalise_api_response(body: dict) -> dict:
    """Unwrap the response envelope down to {ClassName: [objects]}.

    Pioneer nests result -> data -> {ClassName: [...]}. The exact envelope is
    undocumented and has been observed to nest more than one level, so known
    wrapper keys are peeled repeatedly rather than exactly once.
    """
    envelopes = ("result", "output", "response", "data", "structures")
    changed = True
    while changed and isinstance(body, dict):
        changed = False
        for key in envelopes:
            if isinstance(body.get(key), dict):
                body = body[key]
                changed = True
                break
    return {
        name: objects if isinstance(objects, list) else [objects]
        for name, objects in body.items()
        if isinstance(objects, (list, dict))
    }


def _attach_spans(structures: dict, text: str) -> dict:
    """Give every extracted value a uniform {text, confidence, start, end}.

    When the backend supplies offsets they are kept. Otherwise the value is
    located in the source text, consuming each match so repeated strings do not
    all collapse onto the first occurrence. A value that cannot be found gets
    start/end of None - callers must treat that as "no provenance", never as 0.
    """
    used: list[tuple[int, int]] = []

    def locate(value: str):
        start = -1
        while True:
            start = text.find(value, start + 1)
            if start == -1:
                return None, None
            end = start + len(value)
            if not any(s < end and start < e for s, e in used):
                used.append((start, end))
                return start, end

    def normalise(value):
        if isinstance(value, dict):
            span = dict(value)
            body = span.get("text")
            if body is None:
                return None
            if span.get("start") is None:
                span["start"], span["end"] = locate(body)
            span.setdefault("confidence", None)
            return span
        if isinstance(value, str):
            start, end = locate(value)
            return {"text": value, "confidence": None, "start": start, "end": end}
        return None

    result = {}
    for name, objects in structures.items():
        rows = []
        for obj in objects:
            if not isinstance(obj, dict):
                continue
            row = {}
            for field, value in obj.items():
                if isinstance(value, list):
                    items = [normalise(v) for v in value]
                    row[field] = [i for i in items if i]
                else:
                    normalised = normalise(value)
                    if normalised:
                        row[field] = normalised
            if row:
                rows.append(row)
        if rows:
            result[name] = rows
    return result


def load(kind: str | None = None):
    """Build the configured backend. PARALLAX_EXTRACTOR=local|pioneer."""
    kind = (kind or os.environ.get("PARALLAX_EXTRACTOR", "local")).strip().lower()
    if kind == "local":
        return LocalExtractor()
    if kind == "pioneer":
        return PioneerExtractor()
    raise ExtractionError(f"unknown extractor {kind!r} (expected 'local' or 'pioneer')")
