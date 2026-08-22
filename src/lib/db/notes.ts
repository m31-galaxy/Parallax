/**
 * Note capture (spec §5, §6): Note is the built-in class backing freeform
 * capture — `created` (datetime, database-defaulted and readonly) and
 * `content` (long text). It is a completely ordinary class: registered in
 * the meta table, listed in the sidebar, editable via the class designer.
 *
 * Provisioning is automatic on first use and idempotent; the meta record is
 * INSERT IGNOREd so user customisations (plural, field order) are never
 * clobbered by a revisit.
 */

import { RecordId, Table } from 'surrealdb';
import type { DateTime, Surreal } from 'surrealdb';
import { ENSURE_META, META_TABLE } from './classes.svelte';

export const NOTE_CLASS = 'Note';

export interface NoteRecord {
    id: RecordId;
    created: DateTime;
    content: string;
}

const ENSURE_NOTE = `
DEFINE TABLE IF NOT EXISTS ${NOTE_CLASS} SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS created ON ${NOTE_CLASS} TYPE datetime DEFAULT time::now() READONLY;
DEFINE FIELD IF NOT EXISTS content ON ${NOTE_CLASS} TYPE string;
${ENSURE_META};
INSERT IGNORE INTO ${META_TABLE} $note_meta;
`;

/** Idempotent: creates the Note class and its meta record if missing. */
export async function ensureNoteClass(db: Surreal): Promise<void> {
    await db.query(ENSURE_NOTE, {
        note_meta: {
            id: new RecordId(META_TABLE, NOTE_CLASS),
            table_name: NOTE_CLASS,
            plural: 'Notes',
            fields: [
                { name: 'created', ui_type: 'datetime' },
                { name: 'content', ui_type: 'long_text' }
            ]
        }
    });
}

export async function listNotes(db: Surreal): Promise<NoteRecord[]> {
    const [rows] = await db.query<[NoteRecord[]]>(
        `SELECT * FROM ${NOTE_CLASS} ORDER BY created DESC`
    );
    return rows;
}

/** `created` is filled by the database (DEFAULT time::now()). */
export async function createNote(db: Surreal, content: string): Promise<void> {
    await db.create<NoteRecord>(new Table(NOTE_CLASS)).content({ content });
}

/** Merge, not replace: `created` is readonly and must be left untouched. */
export async function updateNote(db: Surreal, id: RecordId, content: string): Promise<void> {
    await db.update<NoteRecord>(id).merge({ content });
}

export async function deleteNote(db: Surreal, id: RecordId): Promise<void> {
    await db.delete(id);
}
