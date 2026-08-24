<script lang="ts">
    import { resolve } from '$app/paths';
    import { page } from '$app/state';
    import { classStore, getClass, type ClassView } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { DelayedLoading } from '$lib/loading.svelte';
    import {
        deleteObject,
        formatValue,
        listObjects,
        objectId,
        objectLabel,
        type ObjectRecord
    } from '$lib/db/objects';

    let cls = $state<ClassView | null>(null);
    let objects = $state<ObjectRecord[] | null>(null);
    // Reference display labels (spec §4 heuristic): field name → rid → label.
    let refLabels = $state<Record<string, Record<string, string>>>({});
    let loadError = $state<string | null>(null);
    let actionError = $state<string | null>(null);
    let busy = $state(false);
    const loading = new DelayedLoading();
    let requestToken = 0;

    const className = $derived(page.params.name ?? '');
    const singular = $derived(classStore.all.find((c) => c.name === className)?.name ?? className);

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
        confirmingDelete = null;
        try {
            const view = await getClass(connection.client, name);
            const rows = await listObjects(connection.client, name);
            const labels: Record<string, Record<string, string>> = {};
            for (const field of view.fields) {
                if (field.uiType !== 'reference' || field.target === undefined) continue;
                const targetClass = await getClass(connection.client, field.target);
                const targets = await listObjects(connection.client, field.target);
                labels[field.name] = Object.fromEntries(
                    targets.map((record) => [String(record.id), objectLabel(targetClass, record)])
                );
            }
            if (token !== requestToken) return;
            cls = view;
            objects = rows;
            refLabels = labels;
        } catch (err) {
            if (token !== requestToken) return;
            loadError = toMessage(err);
            cls = null;
            objects = null;
        } finally {
            if (token === requestToken) loading.finish();
        }
    }

    // Two-step confirm instead of window.confirm: native dialogs are
    // suppressed in some embedded browsers, silently cancelling the delete.
    let confirmingDelete = $state<string | null>(null);

    function requestRemove(record: ObjectRecord): void {
        const id = objectId(record);
        if (confirmingDelete !== id) {
            confirmingDelete = id;
            return;
        }
        confirmingDelete = null;
        void remove(record);
    }

    async function remove(record: ObjectRecord): Promise<void> {
        busy = true;
        actionError = null;
        try {
            await deleteObject(connection.client, className, objectId(record));
            await load(className);
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
    {:else if loading.pending || cls === null || objects === null}
        <p class="muted">Loading…</p>
    {:else}
        <a class="button" href={resolve('/classes/[name]/new', { name: className })}>
            New {singular}
        </a>

        {#if objects.length === 0}
            <p class="muted">No {cls.plural.toLowerCase()} yet.</p>
        {:else}
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            {#each cls.fields as field (field.name)}
                                <th>{field.name}</th>
                            {/each}
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each objects as record (String(record.id))}
                            <tr>
                                {#each cls.fields as field (field.name)}
                                    <td>
                                        {field.uiType === 'reference' && record[field.name] != null
                                            ? (refLabels[field.name]?.[
                                                  String(record[field.name])
                                              ] ?? formatValue(record[field.name]))
                                            : formatValue(record[field.name])}
                                    </td>
                                {/each}
                                <td class="row-actions">
                                    <a
                                        href={resolve('/classes/[name]/[id]', {
                                            name: className,
                                            id: objectId(record)
                                        })}
                                    >
                                        Edit
                                    </a>
                                    <button
                                        class:danger={confirmingDelete === objectId(record)}
                                        disabled={busy}
                                        onclick={() => requestRemove(record)}
                                    >
                                        {confirmingDelete === objectId(record)
                                            ? 'Really delete?'
                                            : 'Delete'}
                                    </button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        {/if}

        {#if actionError !== null}
            <p class="error">{actionError}</p>
        {/if}
    {/if}
</main>

<style>
    main {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: flex-start;
    }

    .muted {
        color: #666;
    }

    .button {
        display: inline-block;
        font-size: 0.9rem;
        padding: 0.4rem 0.8rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        color: inherit;
        text-decoration: none;
    }

    .table-wrap {
        max-width: 100%;
        overflow-x: auto;
    }

    table {
        border-collapse: collapse;
        background: #fff;
        border: 1px solid #ddd;
    }

    th,
    td {
        text-align: left;
        padding: 0.45rem 0.75rem;
        border-bottom: 1px solid #eee;
        font-size: 0.95rem;
        white-space: nowrap;
    }

    th {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #666;
        font-family: monospace;
    }

    tbody tr:last-child td {
        border-bottom: none;
    }

    .row-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }

    .row-actions a {
        color: #555;
    }

    .row-actions button {
        font: inherit;
        font-size: 0.85rem;
        padding: 0.15rem 0.5rem;
        border: 1px solid #bbb;
        border-radius: 4px;
        background: #fff;
        cursor: pointer;
        white-space: nowrap;
    }

    .row-actions button.danger {
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
    }
</style>
