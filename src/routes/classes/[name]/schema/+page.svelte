<script lang="ts">
    import { page } from '$app/state';
    import {
        addField,
        classStore,
        FIELD_TYPE_LABELS,
        FIELD_TYPES,
        getClass,
        isValidFieldName,
        updatePlural,
        type ClassView,
        type NewField
    } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { DelayedLoading } from '$lib/loading.svelte';

    let cls = $state<ClassView | null>(null);
    let loadError = $state<string | null>(null);
    let busy = $state(false);
    let actionError = $state<string | null>(null);
    const loading = new DelayedLoading();
    let requestToken = 0;

    let pluralDraft = $state('');
    let newField = $state<NewField>({ name: '', type: 'text', required: false, hint: '' });

    const className = $derived(page.params.name ?? '');

    $effect(() => {
        void load(className);
    });

    function toMessage(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
    }

    // Stale-while-loading: previous content stays visible unless the load
    // outlives the grace window; the token discards out-of-order responses.
    async function load(name: string): Promise<void> {
        const token = ++requestToken;
        loading.start();
        loadError = null;
        actionError = null;
        try {
            const view = await getClass(connection.client, name);
            if (token !== requestToken) return;
            cls = view;
            pluralDraft = view.plural;
        } catch (err) {
            if (token !== requestToken) return;
            loadError = toMessage(err);
            cls = null;
        } finally {
            if (token === requestToken) loading.finish();
        }
    }

    const fieldNameInvalid = $derived(
        newField.name !== '' &&
            (!isValidFieldName(newField.name) ||
                (cls?.fields.some((f) => f.name === newField.name) ?? false))
    );

    async function submitField(): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await addField(connection.client, className, newField);
            newField = { name: '', type: 'text', required: false, hint: '' };
            await load(className);
            await classStore.refresh();
        } catch (err) {
            actionError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    async function savePlural(): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await updatePlural(connection.client, className, pluralDraft.trim());
            await load(className);
            await classStore.refresh();
        } catch (err) {
            actionError = toMessage(err);
        } finally {
            busy = false;
        }
    }
</script>

<main>
    {#if loadError !== null}
        <p class="error">{loadError}</p>
    {:else if loading.pending || cls === null}
        <p class="muted">Loading…</p>
    {:else}
        <form
            class="plural"
            onsubmit={(event) => {
                event.preventDefault();
                void savePlural();
            }}
        >
            <label>
                Plural name
                <input bind:value={pluralDraft} required />
            </label>
            <button type="submit" disabled={busy || pluralDraft.trim() === cls.plural}>
                Save
            </button>
        </form>

        <h2>Fields</h2>
        {#if cls.fields.length === 0}
            <p class="muted">No fields yet.</p>
        {:else}
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Required</th>
                        <th>Description</th>
                    </tr>
                </thead>
                <tbody>
                    {#each cls.fields as field (field.name)}
                        <tr>
                            <td><code>{field.name}</code></td>
                            <td>
                                {field.uiType
                                    ? FIELD_TYPE_LABELS[field.uiType]
                                    : `unsupported (${field.surrealType})`}
                            </td>
                            <td>{field.required ? 'yes' : 'no'}</td>
                            <td class="hint-cell">{field.hint ?? '—'}</td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        {/if}

        <form
            class="add-field"
            onsubmit={(event) => {
                event.preventDefault();
                void submitField();
            }}
        >
            <input
                bind:value={newField.name}
                placeholder="field_name"
                aria-label="New field name"
            />
            <select bind:value={newField.type} aria-label="New field type">
                {#each FIELD_TYPES as type (type)}
                    <option value={type}>{FIELD_TYPE_LABELS[type]}</option>
                {/each}
            </select>
            <label class="required">
                <input type="checkbox" bind:checked={newField.required} />
                required
            </label>
            <input
                class="hint"
                bind:value={newField.hint}
                placeholder="Description (optional) — helps distillation"
                aria-label="Field description for distillation"
            />
            <button type="submit" disabled={busy || newField.name === '' || fieldNameInvalid}>
                Add field
            </button>
        </form>
        {#if fieldNameInvalid}
            <p class="error">Field name must be snake_case, not "id", and not already in use.</p>
        {/if}
        {#if actionError !== null}
            <p class="error">{actionError}</p>
        {/if}
    {/if}
</main>

<style>
    main {
        max-width: 40rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    h2 {
        margin: 0.5rem 0 0;
        font-size: 1rem;
    }

    .muted {
        color: #666;
    }

    .plural {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }

    table {
        border-collapse: collapse;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 6px;
    }

    th,
    td {
        text-align: left;
        padding: 0.45rem 0.75rem;
        border-bottom: 1px solid #eee;
        font-size: 0.95rem;
    }

    th {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #666;
    }

    tbody tr:last-child td {
        border-bottom: none;
    }

    .add-field {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
    }

    .add-field input:not([type='checkbox']):not(.hint) {
        flex: 1;
    }

    .add-field .hint {
        flex-basis: 100%;
        font-size: 0.85rem;
    }

    .hint-cell {
        color: #555;
        font-size: 0.85rem;
    }

    label.required {
        flex-direction: row;
        align-items: center;
        gap: 0.3rem;
        white-space: nowrap;
    }

    input,
    select {
        font: inherit;
        padding: 0.4rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    button {
        font: inherit;
        padding: 0.4rem 0.8rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
    }

    button:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .error {
        margin: 0;
        color: #b3261e;
        background: #fdeceb;
        border: 1px solid #f3c0bc;
        border-radius: 4px;
        padding: 0.5rem 0.75rem;
        overflow-wrap: anywhere;
    }
</style>
