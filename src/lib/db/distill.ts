/**
 * Distillation (spec §6), the app half. The browser cannot run the extraction
 * model, so it uses the database as a queue: `requestDistill` writes a
 * `parallax_distill_request` row, a local worker fills in `parallax_proposal`
 * rows, and the app reads them back here. Review — approve into the target
 * class, or reject — happens entirely in the browser, because it is only
 * SurrealQL plus the same type coercion object creation already uses.
 *
 * The worker is external tooling (experiments/distill-harness/worker.py); this
 * module never calls it, only shares the database with it, so the app stays a
 * pure SPA (spec §3, §7).
 */

import { DateTime, RecordId, Table } from 'surrealdb';
import type { Surreal } from 'surrealdb';
import { getClass, type ClassView, type FieldView } from './classes.svelte';

export const REQUEST_TABLE = 'parallax_distill_request';
export const PROPOSAL_TABLE = 'parallax_proposal';

export type RequestStatus = 'pending' | 'running' | 'done' | 'error';

export interface DistillRequest {
    id: RecordId;
    note: RecordId;
    status: RequestStatus;
    error?: string;
    proposal_count?: number;
}

export interface Proposal {
    id: RecordId;
    note: RecordId;
    class_name: string;
    payload: Record<string, unknown>;
    confidence: number;
    status: 'pending' | 'approved' | 'rejected';
    extractor?: string;
    committed?: RecordId;
}

/** Ask the worker to distil a note. Returns the request id to poll. */
export async function requestDistill(db: Surreal, noteId: RecordId): Promise<RecordId> {
    const [rows] = await db.query<[{ id: RecordId }[]]>(
        `CREATE ${REQUEST_TABLE} SET note = $note, status = "pending"`,
        { note: noteId }
    );
    return rows[0].id;
}

export async function getRequest(db: Surreal, id: RecordId): Promise<DistillRequest | undefined> {
    const [rows] = await db.query<[DistillRequest[]]>(`SELECT * FROM $id`, { id });
    return rows[0];
}

/** Pending proposals for a note, newest first. */
export async function listProposals(db: Surreal, noteId: RecordId): Promise<Proposal[]> {
    const [rows] = await db.query<[Proposal[]]>(
        `SELECT * FROM ${PROPOSAL_TABLE} WHERE note = $note AND status = "pending" ORDER BY confidence DESC`,
        { note: noteId }
    );
    return rows;
}

// --- coercion ----------------------------------------------------------------

const TRUE_WORDS = new Set(['yes', 'y', 'true', 't', '1', 'on']);
const FALSE_WORDS = new Set(['no', 'n', 'false', 'f', '0', 'off']);

/** One field's extracted text turned into its typed value, or an error. */
export interface Coerced {
    value?: unknown;
    error?: string;
}

function coerceNumber(text: string): Coerced {
    const cleaned = text.replace(/[^\d.-]/g, '');
    const n = Number(cleaned);
    if (cleaned === '' || Number.isNaN(n)) return { error: `“${text}” is not a number` };
    return { value: n };
}

function coerceBoolean(text: string): Coerced {
    const word = text.trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return { value: true };
    if (FALSE_WORDS.has(word)) return { value: false };
    return { error: `“${text}” is not yes/no` };
}

function coerceDatetime(text: string): Coerced {
    // A plain ISO or Date-parseable string. Deliberately conservative: vague
    // phrases ("next Thursday") are left for the user rather than guessed.
    const cleaned = text
        .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1')
        .replace(/^(on|at|the)\s+/i, '')
        .trim();
    const parsed = new Date(cleaned);
    if (Number.isNaN(parsed.getTime())) return { error: `“${text}” is not a date this can read` };
    // A date with no year parses to the current year in most engines already.
    return { value: new DateTime(parsed) };
}

/** The model returns strings (or a list of them); reduce to one string. */
function asText(raw: unknown): string {
    const cell: unknown = Array.isArray(raw) ? (raw[0] as unknown) : raw;
    if (cell == null) return '';
    if (typeof cell === 'string') return cell;
    if (typeof cell === 'number' || typeof cell === 'boolean' || typeof cell === 'bigint') {
        return String(cell);
    }
    return JSON.stringify(cell) ?? '';
}

export function coerceField(field: FieldView, raw: unknown): Coerced {
    const text = asText(raw);
    if (text.trim() === '') return {};
    switch (field.uiType) {
        case 'number':
            return coerceNumber(text);
        case 'boolean':
            return coerceBoolean(text);
        case 'datetime':
            return coerceDatetime(text);
        case 'text':
        case 'long_text':
            return { value: text };
        default:
            return {}; // unsupported field type: skip
    }
}

export interface CoercedProposal {
    values: Record<string, unknown>;
    /** Extracted text that would not coerce, kept for the user to see. */
    unparsed: Record<string, { text: unknown; reason: string }>;
    /** Required fields with no usable value; block committing. */
    missing: string[];
}

/** Split a proposal's payload into committable values, failures, and gaps. */
export function coerceProposal(proposal: Proposal, cls: ClassView): CoercedProposal {
    const byName = new Map(cls.fields.map((f) => [f.name, f]));
    const values: Record<string, unknown> = {};
    const unparsed: CoercedProposal['unparsed'] = {};

    for (const [name, raw] of Object.entries(proposal.payload)) {
        const field = byName.get(name);
        if (!field) continue;
        const { value, error } = coerceField(field, raw);
        if (error) unparsed[name] = { text: Array.isArray(raw) ? raw[0] : raw, reason: error };
        else if (value !== undefined) values[name] = value;
    }

    const missing = cls.fields.filter((f) => f.required && !(f.name in values)).map((f) => f.name);
    return { values, unparsed, missing };
}

// --- review ------------------------------------------------------------------

/** Commit a proposal into its class. Throws if it cannot be committed as-is. */
export async function approveProposal(db: Surreal, proposal: Proposal): Promise<RecordId> {
    const cls = await getClass(db, proposal.class_name);
    const { values, missing } = coerceProposal(proposal, cls);

    if (missing.length > 0) {
        throw new Error(`${cls.name} needs ${missing.join(', ')}, which was not extracted`);
    }
    if (Object.keys(values).length === 0) {
        throw new Error('Nothing usable was extracted for this proposal');
    }

    const created = await db.create<{ id: RecordId }>(new Table(cls.name)).content(values);
    const objectId = created[0].id;
    await db.query(`UPDATE $id SET status = "approved", committed = $committed`, {
        id: proposal.id,
        committed: objectId
    });
    return objectId;
}

export async function rejectProposal(db: Surreal, id: RecordId): Promise<void> {
    await db.query(`UPDATE $id SET status = "rejected"`, { id });
}
