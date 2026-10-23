/**
 * Note distillation (spec §6, spike build): after a note is captured, an LLM
 * agent loop reads it, matches mentions against the user's classes, searches
 * the web (Tavily) for publicly-known facts the note omits, and creates or
 * updates objects in the database.
 *
 * Spike caveats (speed over polish, by owner decision):
 * - API keys come from .env via Vite and are visible to the browser; local
 *   development only.
 * - The client calls the Claude API and Tavily directly (no server exists,
 *   spec §7); the LLM provider remains formally undecided (spec §12) — the
 *   spike currently runs on Anthropic because that is the key on hand.
 * - No review step yet — the model writes straight to the database. The
 *   database's SCHEMAFULL validation is the only gate; its errors are fed
 *   back to the model so it can correct itself.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DateTime, RecordId, StringRecordId } from 'surrealdb';
import type { Surreal } from 'surrealdb';
import {
    classStore,
    getClass,
    typeLabel,
    type ClassView,
    type FieldType
} from '$lib/db/classes.svelte';
import { createObject, getObject, listObjects, objectId, updateObject } from '$lib/db/objects';
import { NOTE_CLASS, type NoteRecord } from '$lib/db/notes';

const env = import.meta.env as Record<string, string | undefined>;
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY ?? '';
const TAVILY_KEY = env.TAVILY_API_KEY ?? '';

const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 16;
const MAX_OBJECTS_PER_CLASS = 25;

/** Distillation is only offered when both keys are configured. */
export function distillAvailable(): boolean {
    return ANTHROPIC_KEY !== '' && TAVILY_KEY !== '';
}

export interface DistillJob {
    noteId: string;
    excerpt: string;
    status: 'running' | 'done' | 'error';
    /** Human-readable lines describing what the agent did, in order. */
    log: string[];
    summary: string | null;
    error: string | null;
}

let jobs = $state<DistillJob[]>([]);

export const distillJobs = {
    get all(): DistillJob[] {
        return jobs;
    },
    dismiss(job: DistillJob): void {
        jobs = jobs.filter((j) => j !== job);
    }
};

/** Fire-and-forget: adds a job to the store and runs the agent loop. */
export function startDistillation(db: Surreal, note: NoteRecord): void {
    const content = note.content;
    jobs.unshift({
        noteId: String(note.id),
        excerpt: content.length > 80 ? content.slice(0, 80) + '…' : content,
        status: 'running',
        log: [],
        summary: null,
        error: null
    });
    const job = jobs[0]; // the reactive proxy, so log/status updates render
    void run(db, job, content).catch((err: unknown) => {
        job.status = 'error';
        job.error = err instanceof Error ? err.message : String(err);
    });
}

// --- Agent loop ---------------------------------------------------------------

async function run(db: Surreal, job: DistillJob, content: string): Promise<void> {
    // No server exists (spec §7, caveats above), so the browser talks to the
    // API directly — that is what dangerouslyAllowBrowser acknowledges.
    const client = new Anthropic({ apiKey: ANTHROPIC_KEY, dangerouslyAllowBrowser: true });
    const context = await buildContext(db);
    const messages: Anthropic.Beta.BetaMessageParam[] = [
        {
            role: 'user',
            content: `Today's date: ${new Date().toDateString()}\n\n${context}\n\nNote to distill:\n"""\n${content}\n"""`
        }
    ];

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const response = await client.beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            system: SYSTEM_PROMPT,
            output_config: { effort: 'low' },
            // On a safety decline the API reruns the request on a fallback
            // model inside the same call instead of returning a refusal.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            tools: TOOLS,
            messages
        });
        // Append the response blocks unchanged (thinking blocks included) —
        // the API requires them intact on the next request of the loop.
        messages.push({ role: 'assistant', content: response.content });

        if (response.stop_reason === 'refusal') {
            throw new Error(response.stop_details?.explanation ?? 'the model declined the request');
        }
        const calls = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || calls.length === 0) {
            const text = response.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n')
                .trim();
            job.summary = text === '' ? '(no summary)' : text;
            job.status = 'done';
            return;
        }
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
            results.push({
                type: 'tool_result',
                tool_use_id: call.id,
                content: await runTool(db, job, call)
            });
        }
        messages.push({ role: 'user', content: results });
    }
    job.summary = `Stopped after ${MAX_TURNS} turns.`;
    job.status = 'done';
}

const SYSTEM_PROMPT = `You are the distiller for Parallax, a personal structured-notes database.
You are given the user's class schemas, their existing objects, and one freeform note.

Your job:
1. Find every item mentioned in the note that matches one of the classes.
2. Create objects for new items, and update existing objects when the note (or research) adds or corrects field values. Merge semantics: only send the fields you want to set.
3. When the note mentions something publicly known (a famous person, an event, a place, a product…) whose class fields are missing from the note, use search_web to research the missing values so the database ends up as complete as possible.

Rules:
- Only use classes and fields that exist in the provided schemas. Never create "${NOTE_CLASS}" objects.
- Check existing objects first; update rather than duplicate.
- Only state facts from the note or from search results — if a value is unknown, leave the optional field out. Required fields must be provided.
- Field value formats: datetime = ISO 8601 string, number = JSON number, boolean = JSON boolean, text = string, reference = the target object's id exactly as listed in the context, list = JSON array of element values.
- A reference may only point at an existing object — create the target object first when it is not in the context yet, then use the id the tool result reports.
- A required list field must be present but may be an empty array.
- If a database write fails, the error is returned to you verbatim — fix the data and retry.
- When finished, reply (no tool call) with a 1-3 sentence plain-text summary of what you did. If nothing in the note matches any class, do nothing and say so.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
    {
        name: 'search_web',
        description:
            'Search the web (Tavily) for publicly-known information missing from the note.',
        input_schema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query']
        }
    },
    {
        name: 'create_object',
        description: 'Create a new object of the given class.',
        input_schema: {
            type: 'object',
            properties: {
                class: { type: 'string', description: 'Class (table) name' },
                data: {
                    type: 'object',
                    description: 'Field values keyed by field name',
                    additionalProperties: true
                }
            },
            required: ['class', 'data']
        }
    },
    {
        name: 'update_object',
        description: 'Update an existing object. Merge semantics: only the provided fields change.',
        input_schema: {
            type: 'object',
            properties: {
                class: { type: 'string' },
                id: { type: 'string', description: 'Object id as listed in the context' },
                data: { type: 'object', additionalProperties: true }
            },
            required: ['class', 'id', 'data']
        }
    }
];

async function runTool(
    db: Surreal,
    job: DistillJob,
    call: Anthropic.Beta.BetaToolUseBlock
): Promise<string> {
    const args = (call.input ?? {}) as Record<string, unknown>;
    try {
        switch (call.name) {
            case 'search_web': {
                const query = asString(args.query);
                job.log.push(`Searched the web: “${query}”`);
                return await searchWeb(query);
            }
            case 'create_object': {
                const className = asString(args.class);
                const cls = await loadClass(db, className);
                const data = coerce(cls, args.data);
                const created = await createObject(db, className, data);
                job.log.push(`Created ${className}: ${describe(data)}`);
                return `Created ${className} with id "${objectId(created)}".`;
            }
            case 'update_object': {
                const className = asString(args.class);
                const id = asString(args.id);
                const cls = await loadClass(db, className);
                const existing = await getObject(db, className, id);
                if (existing === undefined) {
                    return `Error: no ${className} object with id "${id}".`;
                }
                const patch = coerce(cls, args.data);
                const rest: Record<string, unknown> = { ...existing };
                delete rest.id;
                await updateObject(db, className, id, { ...rest, ...patch });
                job.log.push(`Updated ${className} ${id}: ${describe(patch)}`);
                return `Updated ${className} "${id}".`;
            }
            default:
                return `Error: unknown tool "${call.name}".`;
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        job.log.push(`Failed ${call.name}: ${message}`);
        return `Error: ${message}`;
    }
}

async function searchWeb(query: string): Promise<string> {
    const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${TAVILY_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query, max_results: 5, include_answer: true })
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as {
        answer?: string;
        results?: { title: string; url: string; content: string }[];
    };
    return JSON.stringify({
        answer: body.answer ?? null,
        results: (body.results ?? []).map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content.slice(0, 800)
        }))
    });
}

// --- Context & value conversion ------------------------------------------------

let classCache: Record<string, ClassView> = {};

async function loadClass(db: Surreal, className: string): Promise<ClassView> {
    const cached = classCache[className];
    if (cached) return cached;
    if (className === NOTE_CLASS) throw new Error(`creating ${NOTE_CLASS} objects is not allowed`);
    if (!classStore.all.some((c) => c.name === className)) {
        throw new Error(`unknown class "${className}"`);
    }
    const cls = await getClass(db, className);
    classCache[className] = cls;
    return cls;
}

/** Schemas + existing objects for every class except Note, as prompt text. */
async function buildContext(db: Surreal): Promise<string> {
    classCache = {};
    await classStore.refresh();
    const names = classStore.all.map((c) => c.name).filter((n) => n !== NOTE_CLASS);
    if (names.length === 0) return 'The user has no classes defined yet (besides Note).';

    const sections: string[] = [];
    for (const name of names) {
        const cls = await loadClass(db, name);
        const fields = cls.fields.flatMap((f) =>
            f.type === undefined
                ? []
                : [`  - ${f.name}: ${typeLabel(f.type)}${f.required ? ' (required)' : ''}`]
        );
        const objects = await listObjects(db, name);
        const listed = objects
            .slice(0, MAX_OBJECTS_PER_CLASS)
            .map((o) => {
                const rest: Record<string, unknown> = { ...o };
                delete rest.id;
                return `  - id "${objectId(o)}": ${JSON.stringify(rest, plainJson)}`;
            })
            .join('\n');
        const more =
            objects.length > MAX_OBJECTS_PER_CLASS
                ? `\n  … and ${objects.length - MAX_OBJECTS_PER_CLASS} more (not shown)`
                : '';
        sections.push(
            `Class ${name} (plural: ${cls.plural})\nFields:\n${fields.join('\n')}\n` +
                (objects.length === 0
                    ? 'No existing objects.'
                    : `Existing objects:\n${listed}${more}`)
        );
    }
    return `The user's classes and current objects:\n\n${sections.join('\n\n')}`;
}

function plainJson(_key: string, value: unknown): unknown {
    if (value instanceof DateTime) return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RecordId || value instanceof StringRecordId) return value.toString();
    return value;
}

/** Convert the model's JSON field values to typed ones, per the class schema. */
function coerce(cls: ClassView, raw: unknown): Record<string, unknown> {
    if (raw === null || typeof raw !== 'object') throw new Error('data must be an object');
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        const field = cls.fields.find((f) => f.name === key);
        if (!field) throw new Error(`class ${cls.name} has no field "${key}"`);
        if (field.type === undefined) {
            throw new Error(`field "${key}" has a type this client cannot write`);
        }
        data[key] = coerceValue(key, field.type, value);
    }
    return data;
}

/** Convert one JSON value from the model, recursing through the field's type tree. */
function coerceValue(key: string, type: FieldType, value: unknown): unknown {
    switch (type.kind) {
        case 'number':
            return Number(value);
        case 'boolean':
            return value === true || value === 'true';
        case 'datetime': {
            const date = new Date(asString(value));
            if (Number.isNaN(date.getTime())) {
                throw new Error(`"${key}" is not a valid datetime: ${asString(value)}`);
            }
            return new DateTime(date);
        }
        case 'reference': {
            // The context lists ids bare (`id "x1y2"`) but existing reference
            // values render as "Target:x1y2" — accept either spelling.
            const raw = asString(value);
            return raw.startsWith(`${type.target}:`)
                ? new StringRecordId(raw)
                : new RecordId(type.target, raw);
        }
        case 'list': {
            if (!Array.isArray(value)) throw new Error(`"${key}" must be a JSON array`);
            return value.map((item) => coerceValue(key, type.element, item));
        }
        default:
            return asString(value);
    }
}

function asString(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? '';
}

function describe(data: Record<string, unknown>): string {
    return JSON.stringify(data, plainJson);
}
