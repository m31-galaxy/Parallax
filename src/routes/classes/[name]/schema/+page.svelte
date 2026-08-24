<script lang="ts">
    import { page } from '$app/state';
    import { goto } from '$app/navigation';
    import { resolve } from '$app/paths';
    import {
        addField,
        classStore,
        deleteClass,
        FIELD_TYPE_LABELS,
        FIELD_TYPES,
        getClass,
        isValidFieldName,
        removeField,
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
    let newField = $state<NewField>({ name: '', type: 'text', required: false, target: '' });

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

    const targetMissing = $derived(
        newField.type === 'reference' &&
            !classStore.all.some((c) => c.name === (newField.target ?? ''))
    );

    async function submitField(): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await addField(connection.client, className, newField);
            newField = { name: '', type: 'text', required: false, target: '' };
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

    // Two-step confirm for field removal (destroys that field's data).
    let confirmingRemove = $state<string | null>(null);

    function requestRemoveField(fieldName: string): void {
        if (confirmingRemove !== fieldName) {
            confirmingRemove = fieldName;
            return;
        }
        confirmingRemove = null;
        void doRemoveField(fieldName);
    }

    async function doRemoveField(fieldName: string): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await removeField(connection.client, className, fieldName);
            await load(className);
            await classStore.refresh();
        } catch (err) {
            actionError = toMessage(err);
        } finally {
            busy = false;
        }
    }

    // Typed-name confirm for class deletion (destroys all objects, spec §4).
    let deleteConfirmName = $state('');

    async function doDeleteClass(): Promise<void> {
        if (deleteConfirmName !== className) return;
        busy = true;
        actionError = null;
        try {
            await deleteClass(connection.client, className);
            await classStore.refresh();
            await goto(resolve('/'));
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
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {#each cls.fields as field (field.name)}
                        <tr>
                            <td><code>{field.name}</code></td>
                            <td>
                                {field.uiType === 'reference'
                                    ? `Reference → ${field.target}`
                                    : field.uiType
                                      ? FIELD_TYPE_LABELS[field.uiType]
                                      : `unsupported (${field.surrealType})`}
                            </td>
                            <td>{field.required ? 'yes' : 'no'}</td>
                            <td>
                                <button
                                    class="row-button"
                                    class:danger={confirmingRemove === field.name}
                                    disabled={busy}
                                    onclick={() => requestRemoveField(field.name)}
                                >
                                    {confirmingRemove === field.name ? 'Really remove?' : 'Remove'}
                                </button>
                            </td>
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
            {#if newField.type === 'reference'}
                <select bind:value={newField.target} aria-label="Reference target class">
                    <option value="" disabled>Target class…</option>
                    {#each classStore.all as option (option.name)}
                        <option value={option.name}>{option.name}</option>
                    {/each}
                </select>
            {/if}
            <label class="required">
                <input type="checkbox" bind:checked={newField.required} />
                required
            </label>
            <button
                type="submit"
                disabled={busy || newField.name === '' || fieldNameInvalid || targetMissing}
            >
                Add field
            </button>
        </form>
        {#if fieldNameInvalid}
            <p class="error">Field name must be snake_case, not "id", and not already in use.</p>
        {/if}
        {#if actionError !== null}
            <p class="error">{actionError}</p>
        {/if}

        <section class="danger-zone">
            <h2>Danger zone</h2>
            <p class="muted">
                Deleting this class permanently destroys the class and all its objects.
            </p>
            <form
                onsubmit={(event) => {
                    event.preventDefault();
                    void doDeleteClass();
                }}
            >
                <input
                    bind:value={deleteConfirmName}
                    placeholder={`Type ${className} to confirm`}
                    aria-label="Type the class name to confirm deletion"
                />
                <button
                    type="submit"
                    class="danger"
                    disabled={busy || deleteConfirmName !== className}
                >
                    Delete class
                </button>
            </form>
        </section>
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

    .add-field input:not([type='checkbox']) {
        flex: 1;
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

    button.row-button {
        font-size: 0.85rem;
        padding: 0.15rem 0.5rem;
        white-space: nowrap;
    }

    button.danger {
        color: #b3261e;
        border-color: #d9a5a1;
    }

    .danger-zone {
        margin-top: 1rem;
        border: 1px solid #d9a5a1;
        border-radius: 6px;
        padding: 0.75rem 1rem 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        background: #fff;
    }

    .danger-zone h2 {
        margin: 0;
    }

    .danger-zone form {
        display: flex;
        gap: 0.5rem;
    }

    .danger-zone input {
        flex: 1;
        max-width: 16rem;
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
