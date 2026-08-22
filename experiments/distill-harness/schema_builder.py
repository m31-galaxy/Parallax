"""Build an extraction schema from the classes the user defined in the app.

This is what makes distillation the feature spec section 6 describes rather
than a demo: nothing here names a field. Everything comes from the database.

Mirrors src/lib/db/classes.svelte.ts deliberately:
  * `parallax_class` holds only what the engine cannot - plural name, field
    order, UI type hints (and now an optional extraction hint).
  * `INFO FOR TABLE` is the authority for what fields exist and their types
    (spec section 3). Where the two disagree, the database wins.
"""

import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

META_TABLE = "parallax_class"
NOTE_CLASS = "Note"

# UI type -> extraction dtype. Mirrors SURREAL_TYPES in classes.svelte.ts.
# The model only ever returns text; `coerce` in review.py converts it back.
UI_TO_DTYPE = {
    "text": "str",
    "long_text": "str",
    "number": "str",
    "boolean": "str",
    "datetime": "str",
}

# SurrealDB type -> UI type, for fields with no meta hint.
SURREAL_TO_UI = {
    "string": "text",
    "number": "number",
    "bool": "boolean",
    "datetime": "datetime",
}

# A boolean is extracted as a closed choice and mapped back to a real bool,
# which works far better than hoping the model emits "true".
BOOLEAN_CHOICES = ["yes", "no"]

_TYPE_RE = re.compile(
    r"\sTYPE\s+(.+?)(?:\s+(?:PERMISSIONS|DEFAULT|ASSERT|VALUE|COMMENT|READONLY)\s|$)"
)
_OPTION_RE = re.compile(r"^option<(.+)>$")


class Field:
    __slots__ = ("name", "ui_type", "surreal_type", "required", "hint")

    def __init__(self, name, ui_type, surreal_type, required, hint=None):
        self.name = name
        self.ui_type = ui_type
        self.surreal_type = surreal_type
        self.required = required
        self.hint = hint

    @property
    def description(self) -> str:
        """What the model is told this field means.

        The user's hint if they gave one; otherwise the field name made
        readable, which is weak but better than a bare identifier.
        """
        return self.hint or self.name.replace("_", " ")

    def to_spec(self) -> str:
        """The library's "name::dtype::description" form."""
        if self.ui_type == "boolean":
            dtype = "[" + "|".join(BOOLEAN_CHOICES) + "]"
        else:
            dtype = UI_TO_DTYPE.get(self.ui_type, "str")
        return f"{self.name}::{dtype}::{self.description}"

    def __repr__(self):
        return f"Field({self.name}, {self.ui_type}, required={self.required})"


class ExtractableClass:
    __slots__ = ("name", "plural", "fields")

    def __init__(self, name, plural, fields):
        self.name = name
        self.plural = plural
        self.fields = fields

    def to_structure(self) -> list:
        return [f.to_spec() for f in self.fields]

    def __repr__(self):
        return f"ExtractableClass({self.name}, {len(self.fields)} fields)"


def _parse_type(definition: str):
    """Pull (surreal_type, required) out of a DEFINE FIELD statement."""
    match = _TYPE_RE.search(definition)
    surreal_type = match.group(1).strip() if match else "unknown"
    option = _OPTION_RE.match(surreal_type)
    if option:
        return option.group(1).strip(), False
    # SurrealDB 3.x renders optionals as `none | T`.
    if surreal_type.startswith("none |"):
        return surreal_type.split("|", 1)[1].strip(), False
    return surreal_type, True


def _meta_rows(db):
    """Class metadata, or [] when the app has never written any."""
    try:
        rows = db.query(f"SELECT table_name, plural, fields FROM {META_TABLE}")
    except Exception as err:  # noqa: BLE001 - surfaced verbatim, like the app
        if f"'{META_TABLE}' does not exist" in str(err):
            return []
        raise
    return rows or []


def load_classes(db, skip=(NOTE_CLASS,)):
    """Every user-defined class, as extraction targets.

    Note is skipped by default: it is the source of distillation, not a target.
    """
    classes = []
    for row in _meta_rows(db):
        name = row.get("table_name")
        if not name or name in skip:
            continue

        info = db.query(f"INFO FOR TABLE {name}")
        if not info:
            continue
        definitions = (info[0] if isinstance(info, list) else info).get("fields", {})

        hints = {h.get("name"): h for h in (row.get("fields") or []) if h.get("name")}

        # Meta order first (it is the order the user arranged in the designer),
        # then anything the database has that meta does not know about.
        # `[*]` entries describe array elements, not fields - drop them.
        names = [n for n in definitions if "[*]" not in n]
        ordered = [n for n in hints if n in names] + sorted(n for n in names if n not in hints)

        fields = []
        for field_name in ordered:
            surreal_type, required = _parse_type(definitions[field_name])
            hint = hints.get(field_name, {})

            ui_type = hint.get("ui_type")
            # The hint must agree with the real schema; the schema wins.
            if ui_type not in UI_TO_DTYPE or SURREAL_TO_UI.get(surreal_type) != (
                "text" if ui_type == "long_text" else ui_type
            ):
                ui_type = SURREAL_TO_UI.get(surreal_type)
            if ui_type is None:
                continue  # a type outside the v0.1 set - not extractable

            fields.append(
                Field(field_name, ui_type, surreal_type, required, hint.get("hint") or None)
            )

        if fields:
            classes.append(ExtractableClass(name, row.get("plural") or name, fields))

    return classes


def build_structures(classes) -> dict:
    """{ClassName: ["field::dtype::description", ...]} for the extractor."""
    return {cls.name: cls.to_structure() for cls in classes}


def describe(classes) -> str:
    lines = []
    for cls in classes:
        lines.append(f"{cls.name} ({cls.plural})")
        for field in cls.fields:
            flag = "required" if field.required else "optional"
            source = "hint" if field.hint else "derived"
            lines.append(
                f"    {field.name:<20} {field.ui_type:<10} {flag:<9} "
                f"{source}: {field.description!r}"
            )
    return "\n".join(lines) if lines else "(no extractable classes)"
