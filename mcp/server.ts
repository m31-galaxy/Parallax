/**
 * Parallax MCP server (spec §11): gives LLMs and agents access to a Parallax
 * database over stdio. Structured tools cover schema/data reads and
 * objects + notes CRUD; the two-mode `query` tool accepts full SurrealQL
 * with dry-run-by-default rollback. Run with `bun run mcp`.
 *
 * Configuration (environment variables):
 *   SURREAL_URL         e.g. ws://localhost:8000
 *   SURREAL_NAMESPACE   default "parallax"
 *   SURREAL_DATABASE    the database to serve
 *   SURREAL_AUTH_LEVEL  anonymous | root | namespace | database (default root)
 *   SURREAL_USER / SURREAL_PASS   unless anonymous
 *
 * Recommended registration: a dedicated EDITOR-role database user, capping
 * blast radius independent of tool design.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DateTime, RecordId, Surreal } from 'surrealdb';
import { z } from 'zod';
import { AUTH_LEVELS, systemAuth, type AuthLevel } from '../src/lib/db/auth';
import { getClass, listClasses, type ClassView } from '../src/lib/db/classes';
import {
    createNote,
    deleteNote,
    ensureNoteClass,
    listNotes,
    NOTE_CLASS,
    updateNote
} from '../src/lib/db/notes';
import {
    createObject,
    deleteObject,
    getObject,
    listObjects,
    updateObject
} from '../src/lib/db/objects';

// --- Configuration -----------------------------------------------------------

function requireEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined || value === '') {
        console.error(`Parallax MCP: missing required environment variable ${name}`);
        process.exit(1);
    }
    return value;
}

const url = requireEnv('SURREAL_URL');
const namespace = process.env.SURREAL_NAMESPACE ?? 'parallax';
const database = requireEnv('SURREAL_DATABASE');
const levelRaw = process.env.SURREAL_AUTH_LEVEL ?? 'root';
if (!AUTH_LEVELS.includes(levelRaw as AuthLevel)) {
    console.error(`Parallax MCP: SURREAL_AUTH_LEVEL must be one of ${AUTH_LEVELS.join(', ')}`);
    process.exit(1);
}
const level = levelRaw as AuthLevel;

const db = new Surreal();

async function connect(): Promise<void> {
    const authentication = systemAuth({
        level,
        namespace,
        database,
        username: process.env.SURREAL_USER,
        password: process.env.SURREAL_PASS
    });
    await db.connect(url, {
        namespace,
        database,
        ...(authentication ? { authentication } : {})
    });
}

// --- Result serialisation ----------------------------------------------------

/** Convert SDK value classes into JSON-friendly plain values, recursively. */
function plain(value: unknown): unknown {
    if (value instanceof RecordId) return value.toString();
    if (value instanceof DateTime) return value.toISOString();
    if (Array.isArray(value)) return value.map(plain);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
    }
    return value;
}

interface ToolResult {
    [key: string]: unknown;
    content: { type: 'text'; text: string }[];
    isError?: boolean;
}

function ok(value: unknown): ToolResult {
    const body = typeof value === 'string' ? value : JSON.stringify(plain(value), null, 2);
    return { content: [{ type: 'text', text: body }] };
}

function fail(err: unknown): ToolResult {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function run(action: () => Promise<unknown>): Promise<ToolResult> {
    try {
        return ok(await action());
    } catch (err) {
        return fail(err);
    }
}

// --- Field-aware input coercion ------------------------------------------------

/**
 * JSON has no datetime type; coerce ISO strings into DateTime for datetime
 * fields so SCHEMAFULL coercion accepts them. Null values mean "unset" and
 * are omitted. Everything else passes through for the database to judge.
 */
function coerceData(cls: ClassView, data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        if (value === null) continue;
        const field = cls.fields.find((f) => f.name === key);
        if (field?.uiType === 'datetime' && typeof value === 'string') {
            out[key] = new DateTime(new Date(value));
        } else {
            out[key] = value;
        }
    }
    return out;
}

// --- Server ------------------------------------------------------------------

const server = new McpServer({ name: 'parallax', version: '0.1.0' });

server.registerTool(
    'list_classes',
    {
        description:
            'List all classes (user-defined schemas) in the Parallax database, with their singular (class/table) and plural display names.'
    },
    async () => run(() => listClasses(db))
);

server.registerTool(
    'get_class',
    {
        description:
            'Get a class definition: its plural name and its fields with types (text, long_text, number, boolean, datetime) and required flags.',
        inputSchema: { class: z.string().describe('Class name, PascalCase (e.g. "Person")') }
    },
    async ({ class: className }) => run(() => getClass(db, className))
);

server.registerTool(
    'list_objects',
    {
        description: 'List all objects (records) of a class.',
        inputSchema: { class: z.string().describe('Class name') }
    },
    async ({ class: className }) => run(() => listObjects(db, className))
);

server.registerTool(
    'get_object',
    {
        description: 'Get a single object by class and id (the id part, e.g. "x1y2z3").',
        inputSchema: { class: z.string(), id: z.string() }
    },
    async ({ class: className, id }) =>
        run(async () => {
            const record = await getObject(db, className, id);
            if (record === undefined) throw new Error(`No ${className} with id "${id}" exists`);
            return record;
        })
);

server.registerTool(
    'create_object',
    {
        description:
            'Create an object of a class. Data keys are snake_case field names; datetime values are ISO 8601 strings. The database enforces the schema and rejects invalid data.',
        inputSchema: { class: z.string(), data: z.record(z.unknown()) }
    },
    async ({ class: className, data }) =>
        run(async () => {
            const cls = await getClass(db, className);
            return await createObject(db, className, coerceData(cls, data));
        })
);

server.registerTool(
    'update_object',
    {
        description:
            "Replace an object's content. Provide the FULL desired data (fields omitted or null become unset). Datetime values are ISO 8601 strings.",
        inputSchema: { class: z.string(), id: z.string(), data: z.record(z.unknown()) }
    },
    async ({ class: className, id, data }) =>
        run(async () => {
            const cls = await getClass(db, className);
            await updateObject(db, className, id, coerceData(cls, data));
            return `Updated ${className}:${id}`;
        })
);

server.registerTool(
    'delete_object',
    {
        description: 'Permanently delete an object by class and id.',
        inputSchema: { class: z.string(), id: z.string() }
    },
    async ({ class: className, id }) =>
        run(async () => {
            await deleteObject(db, className, id);
            return `Deleted ${className}:${id}`;
        })
);

server.registerTool(
    'list_notes',
    {
        description:
            'List all notes (freeform captures), newest first. Notes have created (datetime) and content (text).'
    },
    async () =>
        run(async () => {
            await ensureNoteClass(db);
            return await listNotes(db);
        })
);

server.registerTool(
    'create_note',
    {
        description:
            'Capture a new note. The database stamps the creation time; only content is supplied.',
        inputSchema: { content: z.string() }
    },
    async ({ content }) =>
        run(async () => {
            await ensureNoteClass(db);
            await createNote(db, content);
            return 'Note created';
        })
);

server.registerTool(
    'update_note',
    {
        description: "Replace a note's content by id. The created timestamp is preserved.",
        inputSchema: { id: z.string(), content: z.string() }
    },
    async ({ id, content }) =>
        run(async () => {
            await updateNote(db, new RecordId(NOTE_CLASS, id), content);
            return `Updated ${NOTE_CLASS}:${id}`;
        })
);

server.registerTool(
    'delete_note',
    {
        description: 'Permanently delete a note by id.',
        inputSchema: { id: z.string() }
    },
    async ({ id }) =>
        run(async () => {
            await deleteNote(db, new RecordId(NOTE_CLASS, id));
            return `Deleted ${NOTE_CLASS}:${id}`;
        })
);

// Any statement that can mutate contains one of these keywords; the scan is
// conservative — a false positive only routes a read through dry-run.
const WRITE_KEYWORDS = /\b(create|update|delete|upsert|insert|relate|define|remove|alter)\b/i;
// A COMMIT inside the text would escape the dry-run wrapper (spec §11).
const TXN_KEYWORDS = /\b(begin|commit|cancel)\b/i;

server.registerTool(
    'query',
    {
        description:
            'Run raw SurrealQL. Read-only queries execute directly and return results. ' +
            'Queries containing write statements are DRY-RUN by default: executed inside a ' +
            'transaction that is rolled back — errors surface, nothing persists, and the ' +
            'engine withholds result previews for rolled-back writes. Pass dry_run: false ' +
            'to actually commit writes.',
        inputSchema: {
            surql: z.string().describe('SurrealQL statements'),
            dry_run: z
                .boolean()
                .optional()
                .describe('Default true. Set false to commit write statements.')
        }
    },
    async ({ surql, dry_run }) =>
        run(async () => {
            const dryRun = dry_run ?? true;
            if (!WRITE_KEYWORDS.test(surql)) {
                return await db.query(surql);
            }
            if (!dryRun) {
                return await db.query(surql);
            }
            if (TXN_KEYWORDS.test(surql)) {
                throw new Error(
                    'Dry-run cannot wrap queries containing transaction keywords ' +
                        '(BEGIN/COMMIT/CANCEL). Remove them, or pass dry_run: false to run as-is.'
                );
            }
            try {
                await db.query(`BEGIN TRANSACTION;\n${surql};\nCANCEL TRANSACTION;`);
            } catch (err) {
                // A clean rollback surfaces as this error for every statement;
                // any other text means a statement genuinely failed.
                const CANCELLED = 'The query was not executed due to a cancelled transaction';
                const message = err instanceof Error ? err.message : String(err);
                const residue = message
                    .split('\n')
                    .map((line) => line.trim())
                    .filter((line) => line !== '' && !line.includes(CANCELLED));
                if (residue.length > 0) throw err;
            }
            return (
                'Dry run OK: statements executed without error and were rolled back. ' +
                'Nothing was persisted. The engine does not return results for ' +
                'rolled-back writes; pass dry_run: false to commit.'
            );
        })
);

// --- Start -------------------------------------------------------------------

await connect();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Parallax MCP server connected to ${namespace}/${database} at ${url}`);
