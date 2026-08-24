/**
 * Classes (spec §4): a class is a SCHEMAFULL SurrealDB table. The real schema
 * (DEFINE TABLE / DEFINE FIELD, read back via INFO) is the sole authority for
 * structure; the `parallax_class` meta table stores only what the engine
 * cannot hold — plural display name, field order, and UI type hints.
 *
 * Field types are recursive (spec §4: full parity with SurrealDB types is the
 * direction): scalars, references, and lists of any type, nested freely.
 *
 * Naming convention (spec §4) is enforced here as designer validation:
 * PascalCase class names, snake_case field names.
 */

import { escapeIdent, escapeIdPart } from 'surrealdb';
import type { Surreal } from 'surrealdb';
import { connection } from './connection.svelte';

// --- Field type model --------------------------------------------------------

export type FieldType =
    | { kind: 'text' }
    | { kind: 'long_text' }
    | { kind: 'number' }
    | { kind: 'boolean' }
    | { kind: 'datetime' }
    | { kind: 'reference'; target: string }
    | { kind: 'list'; element: FieldType };

export type FieldKind = FieldType['kind'];

export const FIELD_KINDS = [
    'text',
    'long_text',
    'number',
    'boolean',
    'datetime',
    'reference',
    'list'
] as const;

export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
    text: 'Text',
    long_text: 'Long text',
    number: 'Number',
    boolean: 'Boolean',
    datetime: 'Date & time',
    reference: 'Reference',
    list: 'List'
};

export function defaultFieldType(): FieldType {
    return { kind: 'text' };
}

/** Human-readable label, e.g. "List of References → Person". */
export function typeLabel(type: FieldType): string {
    switch (type.kind) {
        case 'reference':
            return `Reference → ${type.target}`;
        case 'list':
            return `List of ${typeLabel(type.element)}`;
        default:
            return FIELD_KIND_LABELS[type.kind];
    }
}

/** Canonical hint string stored in the meta table, e.g. "list<reference<Person>>". */
export function typeToHint(type: FieldType): string {
    switch (type.kind) {
        case 'reference':
            return `reference<${type.target}>`;
        case 'list':
            return `list<${typeToHint(type.element)}>`;
        default:
            return type.kind;
    }
}

/** Parse a hint string; tolerates legacy flat hints (e.g. bare "reference"). */
export function hintToType(hint: string): FieldType | undefined {
    const s = hint.trim();
    if (
        s === 'text' ||
        s === 'long_text' ||
        s === 'number' ||
        s === 'boolean' ||
        s === 'datetime'
    ) {
        return { kind: s };
    }
    if (s === 'reference') return { kind: 'reference', target: '' };
    const ref = /^reference<(.+)>$/.exec(s);
    if (ref) return { kind: 'reference', target: ref[1] };
    const list = /^list<(.+)>$/.exec(s);
    if (list) {
        const element = hintToType(list[1]);
        return element === undefined ? undefined : { kind: 'list', element };
    }
    return undefined;
}

/** The SurrealDB type for a field type (long_text is a UI hint over string). */
function typeToSurreal(type: FieldType): string {
    switch (type.kind) {
        case 'text':
        case 'long_text':
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'bool';
        case 'datetime':
            return 'datetime';
        case 'reference':
            return `record<${escapeIdent(type.target)}>`;
        case 'list':
            return `array<${typeToSurreal(type.element)}>`;
    }
}

/** Parse a SurrealDB type into the field-type tree; undefined if unsupported. */
function surrealToType(surreal: string): FieldType | undefined {
    const s = surreal.trim();
    if (s === 'string') return { kind: 'text' };
    if (s === 'number') return { kind: 'number' };
    if (s === 'bool') return { kind: 'boolean' };
    if (s === 'datetime') return { kind: 'datetime' };
    const record = /^record<(.+)>$/.exec(s);
    if (record) return { kind: 'reference', target: record[1] };
    const array = /^array<(.+)>$/.exec(s);
    if (array) {
        const element = surrealToType(array[1]);
        return element === undefined ? undefined : { kind: 'list', element };
    }
    return undefined;
}

/**
 * The schema is the authority (spec §3); the hint may only upgrade string to
 * long_text, recursively through lists.
 */
function reconcile(schema: FieldType, hint: FieldType | undefined): FieldType {
    if (hint === undefined) return schema;
    if (schema.kind === 'text' && hint.kind === 'long_text') return { kind: 'long_text' };
    if (schema.kind === 'list' && hint.kind === 'list') {
        return { kind: 'list', element: reconcile(schema.element, hint.element) };
    }
    return schema;
}

/** Why a drafted type is not valid yet, or null if it is fine. */
export function fieldTypeProblem(type: FieldType): string | null {
    switch (type.kind) {
        case 'reference':
            return isValidClassName(type.target) ? null : 'needs a target class';
        case 'list':
            return fieldTypeProblem(type.element);
        default:
            return null;
    }
}

/** All reference targets appearing anywhere in the type tree. */
export function referenceTargets(type: FieldType): string[] {
    switch (type.kind) {
        case 'reference':
            return [type.target];
        case 'list':
            return referenceTargets(type.element);
        default:
            return [];
    }
}

// --- Field model -------------------------------------------------------------

export interface NewField {
    name: string;
    type: FieldType;
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
    /** Undefined when the SurrealDB type has no UI equivalent. */
    type?: FieldType;
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

// --- DDL generation ----------------------------------------------------------

/**
 * Existence condition for every reference in the tree, at any depth, as a
 * nested `.all()` expression. Null when the tree holds no references.
 */
function existsExpr(value: string, type: FieldType, depth: number): string | null {
    if (type.kind === 'reference') return `record::exists(${value})`;
    if (type.kind === 'list') {
        const inner = existsExpr(`$e${depth}`, type.element, depth + 1);
        return inner === null ? null : `${value}.all(|$e${depth}| ${inner})`;
    }
    return null;
}

function fieldDefinition(className: string, field: NewField): string {
    const problem = fieldTypeProblem(field.type);
    if (problem !== null) throw new Error(`Field "${field.name}" ${problem}`);

    const surreal = typeToSurreal(field.type);
    const type = field.required ? surreal : `option<${surreal}>`;
    const parts = [
        `DEFINE FIELD ${escapeIdent(field.name)} ON ${escapeIdent(className)} TYPE ${type}`
    ];

    // References get DB-enforced integrity (spec §4): a write-time existence
    // ASSERT at any nesting depth, plus delete behaviour where the engine
    // supports it (top-level references and direct list elements).
    const exists = existsExpr('$value', field.type, 0);
    if (exists !== null) {
        parts.push(field.required ? `ASSERT ${exists}` : `ASSERT $value = NONE OR ${exists}`);
    }
    if (field.type.kind === 'reference') {
        // UNSET would violate a required scalar reference; REJECT the delete.
        parts.push(`REFERENCE ON DELETE ${field.required ? 'REJECT' : 'UNSET'}`);
    } else if (field.type.kind === 'list' && field.type.element.kind === 'reference') {
        // UNSET removes just the deleted element (verified), which keeps the
        // list present — safe even for required lists.
        parts.push('REFERENCE ON DELETE UNSET');
    }
    return parts.join(' ');
}

// --- Reads -------------------------------------------------------------------

async function fetchMeta(db: Surreal, className: string): Promise<MetaRow | undefined> {
    const [rows] = await db.query<[MetaRow[]]>(
        `SELECT table_name, plural, fields FROM ${META_TABLE} WHERE table_name = $name`,
        { name: className }
    );
    return rows[0];
}

/** Map a raw `DEFINE FIELD ...` string to a FieldView, using meta hints. */
function parseFieldDefinition(name: string, definition: string, hints: MetaFieldHint[]): FieldView {
    const match =
        /\sTYPE\s+(.+?)(?:\s+(?:PERMISSIONS|DEFAULT|ASSERT|VALUE|COMMENT|REFERENCE)\s|$)/.exec(
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

    const schemaType = surrealToType(surrealType);
    const hintRaw = hints.find((h) => h.name === name)?.ui_type;
    const hintType = hintRaw === undefined ? undefined : hintToType(hintRaw);
    return {
        name,
        type: schemaType === undefined ? undefined : reconcile(schemaType, hintType),
        surrealType,
        required
    };
}

export async function getClass(db: Surreal, className: string): Promise<ClassView> {
    const [info] = await db.query<[{ fields: Record<string, string> }]>(
        `INFO FOR TABLE ${escapeIdent(className)}`
    );
    const meta = await fetchMeta(db, className);
    const hints = meta?.fields ?? [];

    // Skip generated sub-definitions (`fields[*]`, `tags.*`); meta order
    // first, then any fields defined outside Parallax, alphabetically.
    const names = Object.keys(info.fields).filter((n) => !n.includes('[*]') && !n.includes('.'));
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

// --- Writes ------------------------------------------------------------------

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
        fields: fields.map((f) => ({ name: f.name, ui_type: typeToHint(f.type) }))
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
        hint: [{ name: field.name, ui_type: typeToHint(field.type) }]
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

// --- Reactive class list for the sidebar ------------------------------------

let classes = $state<ClassSummary[]>([]);
let loaded = $state(false);
let listError = $state<string | null>(null);

export const classStore = {
    get all(): ClassSummary[] {
        return classes;
    },
    get loaded(): boolean {
        return loaded;
    },
    get error(): string | null {
        return listError;
    },

    async refresh(): Promise<void> {
        try {
            const [rows] = await connection.client.query<[MetaRow[]]>(
                `SELECT table_name, plural, fields FROM ${META_TABLE} ORDER BY plural`
            );
            classes = rows.map((r) => ({ name: r.table_name, plural: r.plural }));
            listError = null;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // A fresh database has no meta table yet — that is simply "no
            // classes", not an error. Anything else is surfaced.
            if (message.includes(`'${META_TABLE}' does not exist`)) {
                classes = [];
                listError = null;
            } else {
                classes = [];
                listError = message;
            }
        }
        loaded = true;
    },

    clear(): void {
        classes = [];
        loaded = false;
        listError = null;
    }
};
