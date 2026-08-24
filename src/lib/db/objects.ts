/**
 * Object CRUD (spec §4): an object is a record in its class's table. The
 * client converts form input to typed values and passes them through; all
 * validation is the database's (SCHEMAFULL enforcement, verbatim errors).
 */

import { DateTime, RecordId, StringRecordId, Table } from 'surrealdb';
import type { Surreal } from 'surrealdb';
import type { ClassView, FieldView } from './classes.svelte';

export type ObjectRecord = Record<string, unknown> & { id: RecordId };

/** The record's id part as a string, for URLs and stable ordering. */
export function objectId(record: ObjectRecord): string {
    const id = record.id.id;
    return typeof id === 'string' || typeof id === 'number' ? String(id) : JSON.stringify(id);
}

export async function listObjects(db: Surreal, className: string): Promise<ObjectRecord[]> {
    const rows = await db.select<ObjectRecord>(new Table(className));
    return rows.sort((a, b) => objectId(a).localeCompare(objectId(b)));
}

export async function getObject(
    db: Surreal,
    className: string,
    id: string
): Promise<ObjectRecord | undefined> {
    return await db.select<ObjectRecord>(new RecordId(className, id));
}

export async function createObject(
    db: Surreal,
    className: string,
    data: Record<string, unknown>
): Promise<ObjectRecord> {
    const created = await db.create<ObjectRecord>(new Table(className)).content(data);
    return created[0];
}

/** Full-content replace, so cleared optional fields are actually unset. */
export async function updateObject(
    db: Surreal,
    className: string,
    id: string,
    data: Record<string, unknown>
): Promise<void> {
    await db.update<ObjectRecord>(new RecordId(className, id)).content(data);
}

export async function deleteObject(db: Surreal, className: string, id: string): Promise<void> {
    await db.delete(new RecordId(className, id));
}

// --- Form value conversion ---------------------------------------------------

/** Format a Date for a `datetime-local` input (local time, minute precision). */
export function toDatetimeInput(value: Date): string {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return (
        `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
        `T${pad(value.getHours())}:${pad(value.getMinutes())}`
    );
}

export function fromDatetimeInput(value: string): Date {
    return new Date(value);
}

/**
 * Display label for an object: the first text-ish field with a value, falling
 * back to the record id (spec §4 label heuristic).
 */
export function objectLabel(cls: ClassView, record: ObjectRecord): string {
    for (const field of cls.fields) {
        if (field.uiType !== 'text' && field.uiType !== 'long_text') continue;
        const value = record[field.name];
        if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return String(record.id);
}

/** Initial input representation (string/boolean) of a stored value. */
export function toDraftValue(field: FieldView, value: unknown): string | boolean {
    switch (field.uiType) {
        case 'reference':
            return value instanceof RecordId ? value.toString() : '';
        case 'boolean':
            return field.required ? value === true : value == null ? '' : String(value === true);
        case 'datetime': {
            if (value instanceof DateTime) return toDatetimeInput(value.toDate());
            return value instanceof Date ? toDatetimeInput(value) : '';
        }
        default: {
            if (value == null) return '';
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            return JSON.stringify(value) ?? '';
        }
    }
}

/**
 * Convert a draft back to a typed value. Returns `undefined` for "unset":
 * empty optional inputs are omitted so the field stays NONE. Empty required
 * inputs are also omitted — the database rejects them with its own error.
 */
export function fromDraftValue(field: FieldView, draft: string | boolean): unknown {
    if (field.uiType === 'boolean') {
        if (field.required) return draft === true;
        return draft === '' ? undefined : draft === 'true';
    }
    if (typeof draft !== 'string' || draft === '') return undefined;
    switch (field.uiType) {
        case 'number':
            return Number(draft);
        case 'datetime':
            return new DateTime(fromDatetimeInput(draft));
        case 'reference':
            // Draft holds the full record id string ("Person:x1y2").
            return new StringRecordId(draft);
        default:
            return draft;
    }
}

/** Human-readable cell for the object list. */
export function formatValue(value: unknown): string {
    if (value == null) return '—';
    if (value instanceof RecordId) return value.toString();
    if (value instanceof DateTime) return value.toDate().toLocaleString();
    if (value instanceof Date) return value.toLocaleString();
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    return JSON.stringify(value) ?? '—';
}
