/**
 * Object CRUD (spec §4): an object is a record in its class's table. The
 * client converts form input to typed values and passes them through; all
 * validation is the database's (SCHEMAFULL enforcement, verbatim errors).
 */

import { DateTime, RecordId, StringRecordId, Table } from 'surrealdb';
import type { Surreal } from 'surrealdb';
import type { ClassView, FieldType } from './classes.svelte';

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
        if (field.type?.kind !== 'text' && field.type?.kind !== 'long_text') continue;
        const value = record[field.name];
        if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return String(record.id);
}

// --- Recursive draft model ---------------------------------------------------
//
// Drafts are what form inputs bind to: strings for most scalars, booleans for
// checkbox-rendered booleans, arrays of drafts for lists. `required` governs
// the top level only; list elements always exist, so they recurse as required.

export type DraftValue = string | boolean | DraftValue[];

export function toDraft(type: FieldType, value: unknown, required: boolean): DraftValue {
    switch (type.kind) {
        case 'list':
            return Array.isArray(value)
                ? value.map((item) => toDraft(type.element, item, true))
                : [];
        case 'boolean':
            return required ? value === true : value == null ? '' : String(value === true);
        case 'datetime': {
            if (value instanceof DateTime) return toDatetimeInput(value.toDate());
            return value instanceof Date ? toDatetimeInput(value) : '';
        }
        case 'reference':
            return value instanceof RecordId ? value.toString() : '';
        default: {
            if (value == null) return '';
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            return JSON.stringify(value) ?? '';
        }
    }
}

/** A fresh draft for a newly added value (empty input / empty list). */
export function blankDraft(type: FieldType, required: boolean): DraftValue {
    if (type.kind === 'list') return [];
    if (type.kind === 'boolean' && required) return false;
    return '';
}

/**
 * Convert a draft back to a typed value. `undefined` means "unset": empty
 * optional inputs are omitted (NONE), empty required inputs are submitted as
 * missing so the database rejects them with its own error. Empty list items
 * are dropped; a required list always submits (possibly empty, per spec §4).
 */
export function fromDraft(type: FieldType, draft: DraftValue, required: boolean): unknown {
    if (type.kind === 'list') {
        const items = (Array.isArray(draft) ? draft : [])
            .map((item) => fromDraft(type.element, item, true))
            .filter((item) => item !== undefined);
        return required || items.length > 0 ? items : undefined;
    }
    if (type.kind === 'boolean') {
        if (required) return draft === true;
        return draft === '' ? undefined : draft === 'true';
    }
    if (typeof draft !== 'string' || draft === '') return undefined;
    switch (type.kind) {
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

/**
 * Human-readable value for list cells, resolving reference labels via the
 * provided lookup (spec §4 label heuristic).
 */
export function formatTyped(
    type: FieldType | undefined,
    value: unknown,
    labelFor: (target: string, rid: string) => string | undefined
): string {
    if (value == null) return '—';
    if (type?.kind === 'reference' && value instanceof RecordId) {
        return labelFor(type.target, value.toString()) ?? value.toString();
    }
    if (type?.kind === 'list' && Array.isArray(value)) {
        if (value.length === 0) return '—';
        return value.map((item) => formatTyped(type.element, item, labelFor)).join(', ');
    }
    return formatValue(value);
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
