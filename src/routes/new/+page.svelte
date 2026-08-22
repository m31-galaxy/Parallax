<script lang="ts">
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import ObjectForm from '$lib/components/ObjectForm.svelte';
    import { classStore, getClass, type ClassView } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { DelayedLoading } from '$lib/loading.svelte';
    import { createObject } from '$lib/db/objects';
    import {
        createNote,
        deleteNote,
        ensureNoteClass,
        listNotes,
        NOTE_CLASS,
        updateNote,
        type NoteRecord
    } from '$lib/db/notes';
    import { distillAvailable, distillJobs, startDistillation } from '$lib/llm/distill.svelte';

    /** The object type being created; a Note by default (spec §5). */
    let selected = $state<string>(NOTE_CLASS);

    let notes = $state<NoteRecord[] | null>(null);
    let loadError = $state<string | null>(null);
    let actionError = $state<string | null>(null);
    let busy = $state(false);
    const loading = new DelayedLoading();
    let requestToken = 0;

    let draft = $state('');
    let editingId = $state<string | null>(null);
    let editDraft = $state('');

    // Schema-driven form state for non-Note types.
    let cls = $state<ClassView | null>(null);
    let clsError = $state<string | null>(null);
    let submitError = $state<string | null>(null);
    const clsLoading = new DelayedLoading();
    let clsToken = 0;

    $effect(() => {
        if (connection.status === 'connected' && connection.database !== null) {
            void init();
        }
    });

    $effect(() => {
        if (selected !== NOTE_CLASS) void loadClass(selected);
    });

    function toMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    async function init(): Promise<void> {
        // Auto-provision on first use (spec §5); idempotent. If the class
        // already exists but the user lacks DDL rights, listing still works —
        // only surface provisioning errors if the subsequent read also fails.
        try {
            await ensureNoteClass(connection.client);
            await classStore.refresh();
        } catch (err) {
            console.warn('Parallax: Note provisioning failed', err);
        }
        await loadNotes();
    }

    async function loadNotes(): Promise<void> {
        const token = ++requestToken;
        loading.start();
        loadError = null;
        try {
            const rows = await listNotes(connection.client);
            if (token !== requestToken) return;
            notes = rows;
        } catch (err) {
            if (token !== requestToken) return;
            loadError = toMessage(err);
            notes = null;
        } finally {
            if (token === requestToken) loading.finish();
        }
    }

    async function loadClass(name: string): Promise<void> {
        const token = ++clsToken;
        clsLoading.start();
        clsError = null;
        submitError = null;
        try {
            const view = await getClass(connection.client, name);
            if (token !== clsToken) return;
            cls = view;
        } catch (err) {
            if (token !== clsToken) return;
            clsError = toMessage(err);
            cls = null;
        } finally {
            if (token === clsToken) clsLoading.finish();
        }
    }

    async function capture(distill: boolean): Promise<void> {
        const content = draft.trim();
        if (content === '') return;
        busy = true;
        actionError = null;
        try {
            const note = await createNote(connection.client, content);
            draft = '';
            // Fire-and-forget: distillation runs in the background while the
            // user keeps capturing; progress shows in the panel below.
            if (distill) startDistillation(connection.client, note);
            await loadNotes();
        } catch (err) {
            actionError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    async function createOther(data: Record<string, unknown>): Promise<void> {
        busy = true;
        submitError = null;
        try {
            await createObject(connection.client, selected, data);
            await goto(resolve('/classes/[name]', { name: selected }));
        } catch (err) {
            submitError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    function startEdit(note: NoteRecord): void {
        editingId = String(note.id);
        editDraft = note.content;
        confirmingDelete = null;
        actionError = null;
    }

    async function saveEdit(note: NoteRecord): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await updateNote(connection.client, note.id, editDraft);
            editingId = null;
            await loadNotes();
        } catch (err) {
            actionError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    // Two-step confirm instead of window.confirm: native dialogs are
    // suppressed in some embedded browsers, silently cancelling the delete.
    let confirmingDelete = $state<string | null>(null);

    function requestRemove(note: NoteRecord): void {
        const id = String(note.id);
        if (confirmingDelete !== id) {
            confirmingDelete = id;
            return;
        }
        confirmingDelete = null;
        void remove(note);
    }

    async function remove(note: NoteRecord): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await deleteNote(connection.client, note.id);
            if (editingId === String(note.id)) editingId = null;
            await loadNotes();
        } catch (err) {
            actionError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    function captureOnEnter(event: KeyboardEvent): void {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void capture(distillAvailable());
        }
    }
</script>

<main>
    <header class="new-header">
        <h1>New</h1>
        <label>
            <span class="visually-hidden">Object type</span>
            <select bind:value={selected}>
                {#each classStore.all as klass (klass.name)}
                    <option value={klass.name}>{klass.name}</option>
                {/each}
            </select>
        </label>
    </header>

    {#if selected === NOTE_CLASS}
        <form
            class="capture"
            onsubmit={(event) => {
                event.preventDefault();
                void capture(distillAvailable());
            }}
        >
            <textarea
                bind:value={draft}
                rows="3"
                placeholder="Write a note… (⌘⏎ to save)"
                onkeydown={captureOnEnter}></textarea>
            {#if distillAvailable()}
                <div class="capture-actions">
                    <button type="submit" class="primary" disabled={busy || draft.trim() === ''}>
                        Distill
                    </button>
                    <button
                        type="button"
                        disabled={busy || draft.trim() === ''}
                        onclick={() => void capture(false)}
                    >
                        Add note
                    </button>
                </div>
            {:else}
                <button type="submit" disabled={busy || draft.trim() === ''}>Add note</button>
            {/if}
        </form>
        {#if actionError !== null}
            <p class="error">{actionError}</p>
        {/if}

        {#if distillJobs.all.length > 0}
            <section class="jobs">
                <h2>Distillation</h2>
                <ul>
                    {#each distillJobs.all as job (job)}
                        <li class="job">
                            <div class="job-head">
                                <span class="badge {job.status}">
                                    {job.status === 'running'
                                        ? 'Distilling…'
                                        : job.status === 'done'
                                          ? 'Done'
                                          : 'Failed'}
                                </span>
                                <span class="job-excerpt">{job.excerpt}</span>
                                {#if job.status !== 'running'}
                                    <button
                                        class="dismiss"
                                        onclick={() => distillJobs.dismiss(job)}
                                    >
                                        Dismiss
                                    </button>
                                {/if}
                            </div>
                            {#if job.log.length > 0}
                                <ul class="job-log">
                                    {#each job.log as line, i (i)}
                                        <li>{line}</li>
                                    {/each}
                                </ul>
                            {/if}
                            {#if job.summary !== null}
                                <p class="job-summary">{job.summary}</p>
                            {/if}
                            {#if job.error !== null}
                                <p class="error">{job.error}</p>
                            {/if}
                        </li>
                    {/each}
                </ul>
            </section>
        {/if}
    {:else if clsError !== null}
        <p class="error">{clsError}</p>
    {:else if clsLoading.pending || cls === null}
        <p class="muted">Loading…</p>
    {:else}
        {#key cls}
            <ObjectForm
                fields={cls.fields}
                submitLabel="Create {selected}"
                {busy}
                error={submitError}
                onsubmit={(data: Record<string, unknown>) => void createOther(data)}
            />
        {/key}
    {/if}

    <section class="notes">
        <h2>Notes</h2>
        {#if loadError !== null}
            <p class="error">{loadError}</p>
        {:else if loading.pending || notes === null}
            <p class="muted">Loading…</p>
        {:else if notes.length === 0}
            <p class="muted">No notes yet — capture your first thought above.</p>
        {:else}
            <ul class="cards">
                {#each notes as note (String(note.id))}
                    <li class="card">
                        {#if editingId === String(note.id)}
                            <textarea bind:value={editDraft} rows="5"></textarea>
                            <div class="card-actions">
                                <button disabled={busy} onclick={() => void saveEdit(note)}>
                                    Save
                                </button>
                                <button
                                    disabled={busy}
                                    onclick={() => {
                                        editingId = null;
                                        confirmingDelete = null;
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    class="danger"
                                    disabled={busy}
                                    onclick={() => requestRemove(note)}
                                >
                                    {confirmingDelete === String(note.id)
                                        ? 'Really delete?'
                                        : 'Delete'}
                                </button>
                            </div>
                        {:else}
                            <button class="card-body" onclick={() => startEdit(note)}>
                                {note.content}
                            </button>
                            <time>{note.created.toDate().toLocaleString()}</time>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
</main>

<style>
    main {
        max-width: 52rem;
        padding: 1.5rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .new-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    h1 {
        margin: 0;
        font-size: 1.4rem;
    }

    h2 {
        margin: 0;
        font-size: 1rem;
    }

    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }

    select {
        font: inherit;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
    }

    .capture {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 34rem;
    }

    textarea {
        font: inherit;
        padding: 0.5rem 0.6rem;
        border: 1px solid #ccc;
        border-radius: 6px;
        resize: vertical;
    }

    button {
        font: inherit;
        padding: 0.4rem 0.8rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        align-self: flex-start;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .muted {
        color: #666;
    }

    .capture-actions {
        display: flex;
        gap: 0.4rem;
    }

    button.primary {
        background: #1a1a1a;
        color: #fff;
        border-color: #1a1a1a;
    }

    .jobs {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 34rem;
    }

    .jobs > ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .job {
        border: 1px solid #ddd;
        border-radius: 6px;
        background: #fafafa;
        padding: 0.6rem 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        font-size: 0.85rem;
    }

    .job-head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .badge {
        border-radius: 999px;
        padding: 0.1rem 0.55rem;
        font-size: 0.75rem;
        white-space: nowrap;
    }

    .badge.running {
        background: #e8f0fe;
        color: #1a56b0;
    }

    .badge.done {
        background: #e6f4ea;
        color: #19713c;
    }

    .badge.error {
        background: #fdeceb;
        color: #b3261e;
    }

    .job-excerpt {
        color: #666;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
    }

    .job-head .dismiss {
        font-size: 0.75rem;
        padding: 0.15rem 0.5rem;
    }

    .job-log {
        list-style: disc;
        margin: 0;
        padding-left: 1.2rem;
        color: #444;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
        overflow-wrap: anywhere;
    }

    .job-summary {
        margin: 0;
        overflow-wrap: anywhere;
    }

    .notes {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        border-top: 1px solid #ddd;
        padding-top: 1rem;
        margin-top: 0.5rem;
    }

    .cards {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
        gap: 0.75rem;
        align-items: start;
    }

    .card {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        border: 1px solid #ddd;
        border-radius: 6px;
        background: #fff;
        padding: 0.75rem;
    }

    .card-body {
        all: unset;
        cursor: pointer;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 0.95rem;
    }

    .card time {
        color: #888;
        font-size: 0.75rem;
    }

    .card-actions {
        display: flex;
        gap: 0.4rem;
    }

    .card-actions button {
        font-size: 0.85rem;
        padding: 0.2rem 0.55rem;
    }

    button.danger {
        color: #b3261e;
        border-color: #d9a5a1;
    }

    .error {
        margin: 0;
        color: #b3261e;
        background: #fdeceb;
        border: 1px solid #f3c0bc;
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
        overflow-wrap: anywhere;
        max-width: 34rem;
    }
</style>
