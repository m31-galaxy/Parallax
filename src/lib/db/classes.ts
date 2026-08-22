/**
 * Pure class data layer, shared by the web app and the MCP server (spec §11).
 *
 * Classes (spec §4): a class is a SCHEMAFULL SurrealDB table. The real schema
 * (DEFINE TABLE / DEFINE FIELD, read back via INFO) is the sole authority for
 * structure; the `parallax_class` meta table stores only what the engine
 * cannot hold — plural display name, field order, and UI type hints.
 *
 * Naming convention (spec §4) is enforced here as designer validation:
 * PascalCase class names, snake_case field names.
 */

import { escapeIdent, escapeIdPart } from 'surrealdb';
import type { Surreal } from 'surrealdb';

/** UI-level field types for v0.1 (spec §4); more are planned in todo.md. */
export const FIELD_TYPES = ['text', 'long_text', 'number', 'boolean', 'datetime'] as const;
export type UiFieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<UiFieldType, string> = {
    text: 'Text',
    long_text: 'Long text',
    number: 'Number',
    boolean: 'Boolean',
    datetime: 'Date & time'
};

/** UI type → SurrealDB type. `long_text` is a UI hint over plain string. */
const SURREAL_TYPES: Record<UiFieldType, string> = {
    text: 'string',
    long_text: 'string',
    number: 'number',
    boolean: 'bool',
    datetime: 'datetime'
};

export interface NewField {
    name: string;
    type: UiFieldType;
    required: boolean;
}

export interface ClassSummary {
    /** Class (= table) name; also the singular display name. */
    name: string;
    plural: string;
}

/** A field as read back from the database (INFO joined with meta hints). */
export interface FieldView {
    name: string;
    /** Undefined when the SurrealDB type has no v0.1 UI equivalent. */
    uiType?: UiFieldType;
    surrealType: string;
    required: boolean;
}

export interface ClassView extends ClassSummary {
    fields: FieldView[];
}

export function isValidClassName(name: string): boolean {
    return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

export function isValidFieldName(name: string): boolean {
    // `id` is SurrealDB's implicit record id and cannot be a user field.
    return /^[a-z][a-z0-9_]*$/.test(name) && name !== 'id';
}

interface MetaFieldHint {
    name: string;
    ui_type: string;
}

interface MetaRow {
    table_name: string;
    plural: string;
    fields: MetaFieldHint[];
}

export const META_TABLE = 'parallax_class';

/** Idempotent meta-table schema, run before any meta write. */
export const ENSURE_META = `
DEFINE TABLE IF NOT EXISTS ${META_TABLE} SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS table_name ON ${META_TABLE} TYPE string;
DEFINE FIELD IF NOT EXISTS plural ON ${META_TABLE} TYPE string;
DEFINE FIELD IF NOT EXISTS fields ON ${META_TABLE} TYPE array<object>;
DEFINE FIELD IF NOT EXISTS fields[*].name ON ${META_TABLE} TYPE string;
DEFINE FIELD IF NOT EXISTS fields[*].ui_type ON ${META_TABLE} TYPE string;
`;

function fieldDefinition(className: string, field: NewField): string {
    const surrealType = SURREAL_TYPES[field.type];
    const type = field.required ? surrealType : `option<${surrealType}>`;
    return `DEFINE FIELD ${escapeIdent(field.name)} ON ${escapeIdent(className)} TYPE ${type}`;
}

async function fetchMeta(db: Surreal, className: string): Promise<MetaRow | undefined> {
    const [rows] = await db.query<[MetaRow[]]>(
        `SELECT table_name, plural, fields FROM ${META_TABLE} WHERE table_name = $name`,
        { name: className }
    );
    return rows[0];
}

/** Map a raw `DEFINE FIELD ...` string to a FieldView, using meta hints. */
function parseFieldDefinition(name: string, definition: string, hints: MetaFieldHint[]): FieldView {
    const match = /\sTYPE\s+(.+?)(?:\s+(?:PERMISSIONS|DEFAULT|ASSERT|VALUE|COMMENT)\s|$)/.exec(
        definition
    );
    let surrealType = match ? match[1].trim() : 'unknown';
    let required = true;
    // Optional fields appear as `option<T>` or (SurrealDB 3.x) as `none | T`.
    const optionMatch = /^option<(.+)>$/.exec(surrealType);
    if (optionMatch) {
        required = false;
        surrealType = optionMatch[1].trim();
    } else {
        const parts = surrealType.split('|').map((part) => part.trim());
        if (parts.includes('none')) {
            required = false;
            surrealType = parts.filter((part) => part !== 'none').join(' | ');
        }
    }

    const hint = hints.find((h) => h.name === name)?.ui_type;
    let uiType = FIELD_TYPES.find((t) => t === hint);
    // The hint must agree with the real schema; the schema wins (spec §3).
    if (uiType && SURREAL_TYPES[uiType] !== surrealType) uiType = undefined;
    if (!uiType) {
        uiType = FIELD_TYPES.find((t) => SURREAL_TYPES[t] === surrealType && t !== 'long_text');
    }
    return { name, uiType, surrealType, required };
}

export async function getClass(db: Surreal, className: string): Promise<ClassView> {
    const [info] = await db.query<[{ fields: Record<string, string> }]>(
        `INFO FOR TABLE ${escapeIdent(className)}`
    );
    const meta = await fetchMeta(db, className);
    const hints = meta?.fields ?? [];

    // Meta order first, then any fields defined outside Parallax, alphabetically.
    const names = Object.keys(info.fields).filter((n) => !n.includes('[*]'));
    const ordered = [
        ...hints.map((h) => h.name).filter((n) => names.includes(n)),
        ...names.filter((n) => !hints.some((h) => h.name === n)).sort()
    ];

    return {
        name: className,
        plural: meta?.plural ?? className,
        fields: ordered.map((n) => parseFieldDefinition(n, info.fields[n], hints))
    };
}

export async function createClass(
    db: Surreal,
    name: string,
    plural: string,
    fields: NewField[]
): Promise<void> {
    const statements = [
        `DEFINE TABLE ${escapeIdent(name)} SCHEMAFULL`,
        ...fields.map((f) => fieldDefinition(name, f)),
        ENSURE_META,
        `UPSERT ${META_TABLE}:${escapeIdPart(name)} SET table_name = $name, plural = $plural, fields = $fields`
    ];
    await db.query(statements.join(';\n'), {
        name,
        plural,
        fields: fields.map((f) => ({ name: f.name, ui_type: f.type }))
    });
}

export async function addField(db: Surreal, className: string, field: NewField): Promise<void> {
    const statements = [
        fieldDefinition(className, field),
        ENSURE_META,
        `UPSERT ${META_TABLE}:${escapeIdPart(className)} SET table_name = $name, plural = plural OR $name, fields = (fields OR []) + $hint`
    ];
    await db.query(statements.join(';\n'), {
        name: className,
        hint: [{ name: field.name, ui_type: field.type }]
    });
}

/** Remove a field definition and purge its stored values from all objects. */
export async function removeField(
    db: Surreal,
    className: string,
    fieldName: string
): Promise<void> {
    const statements = [
        `REMOVE FIELD ${escapeIdent(fieldName)} ON ${escapeIdent(className)}`,
        // Stored values survive REMOVE FIELD (verified against SurrealDB 3.2);
        // purge them so no hidden data lingers in the records.
        `UPDATE ${escapeIdent(className)} SET ${escapeIdent(fieldName)} = NONE`,
        ENSURE_META,
        `UPSERT ${META_TABLE}:${escapeIdPart(className)} SET table_name = $name, plural = plural OR $name, fields = array::filter(fields OR [], |$f| $f.name != $field)`
    ];
    await db.query(statements.join(';\n'), { name: className, field: fieldName });
}

/** Remove the class's table — destroying all its objects — and its meta record. */
export async function deleteClass(db: Surreal, className: string): Promise<void> {
    await db.query(
        `REMOVE TABLE ${escapeIdent(className)};\nDELETE ${META_TABLE}:${escapeIdPart(className)}`
    );
}

export async function updatePlural(db: Surreal, className: string, plural: string): Promise<void> {
    await db.query(
        `${ENSURE_META};\nUPSERT ${META_TABLE}:${escapeIdPart(className)} SET table_name = $name, plural = $plural, fields = fields OR []`,
        { name: className, plural }
    );
}

/**
 * List classes from the meta table. A database with no meta table yet has
 * no classes — that specific error reads as an empty list.
 */
export async function listClasses(db: Surreal): Promise<ClassSummary[]> {
    try {
        const [rows] = await db.query<[MetaRow[]]>(
            `SELECT table_name, plural, fields FROM ${META_TABLE} ORDER BY plural`
        );
        return rows.map((r) => ({ name: r.table_name, plural: r.plural }));
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes(`'${META_TABLE}' does not exist`)) return [];
        throw err;
    }
}
