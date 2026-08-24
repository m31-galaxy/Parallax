<script lang="ts">
    import { FIELD_TYPE_LABELS, getClass, type FieldView } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { fromDraftValue, listObjects, objectLabel, toDraftValue } from '$lib/db/objects';

    interface Props {
        fields: FieldView[];
        initial?: Record<string, unknown>;
        submitLabel: string;
        busy?: boolean;
        error?: string | null;
        onsubmit: (data: Record<string, unknown>) => void;
    }

    let {
        fields,
        initial = {},
        submitLabel,
        busy = false,
        error = null,
        onsubmit
    }: Props = $props();

    const editable = $derived(fields.filter((f) => f.uiType !== undefined));
    const skipped = $derived(fields.filter((f) => f.uiType === undefined));

    // Intentional init-time snapshot: the form owns its draft, and parents
    // remount the component when the target record changes.
    // svelte-ignore state_referenced_locally
    let draft = $state<Record<string, string | boolean>>(
        Object.fromEntries(
            fields
                .filter((f) => f.uiType !== undefined)
                .map((f) => [f.name, toDraftValue(f, initial[f.name])])
        )
    );

    // Options for reference pickers, keyed by field name. Loaded once per
    // mount (parents remount the form when the target record changes).
    interface RefOption {
        value: string;
        label: string;
    }
    let refOptions = $state<Record<string, RefOption[] | null>>({});
    let refError = $state<string | null>(null);

    $effect(() => {
        for (const field of fields) {
            if (field.uiType === 'reference' && field.target !== undefined) {
                void loadRefOptions(field.name, field.target);
            }
        }
    });

    async function loadRefOptions(fieldName: string, target: string): Promise<void> {
        refOptions[fieldName] ??= null;
        try {
            const targetClass = await getClass(connection.client, target);
            const records = await listObjects(connection.client, target);
            const options = records.map((record) => ({
                value: String(record.id),
                label: objectLabel(targetClass, record)
            }));
            // Preserve a link whose target no longer appears (e.g. created
            // outside Parallax) rather than silently dropping it.
            const current = draft[fieldName];
            if (
                typeof current === 'string' &&
                current !== '' &&
                !options.some((o) => o.value === current)
            ) {
                options.push({ value: current, label: `${current} (missing)` });
            }
            refOptions[fieldName] = options;
        } catch (err) {
            refError = err instanceof Error ? err.message : String(err);
            refOptions[fieldName] = [];
        }
    }

    function submit(): void {
        const data: Record<string, unknown> = {};
        for (const field of editable) {
            const value = fromDraftValue(field, draft[field.name]);
            if (value !== undefined) data[field.name] = value;
        }
        onsubmit(data);
    }
</script>

<form
    onsubmit={(event) => {
        event.preventDefault();
        submit();
    }}
>
    {#each editable as field (field.name)}
        {#if field.uiType === 'reference'}
            <label>
                <span>
                    <code>{field.name}</code>
                    <small>
                        {field.target} reference
                        {field.required ? '· required' : ''}
                    </small>
                </span>
                <select bind:value={draft[field.name]} required={field.required}>
                    {#if !field.required}
                        <option value="">—</option>
                    {:else}
                        <option value="" disabled>Select a {field.target}…</option>
                    {/if}
                    {#each refOptions[field.name] ?? [] as option (option.value)}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
                {#if refOptions[field.name]?.length === 0}
                    <small>No {field.target} objects exist yet.</small>
                {/if}
            </label>
        {:else if field.uiType === 'boolean'}
            {#if field.required}
                <label class="inline">
                    <input type="checkbox" bind:checked={draft[field.name] as boolean} />
                    <code>{field.name}</code>
                </label>
            {:else}
                <label>
                    <code>{field.name}</code>
                    <select bind:value={draft[field.name]}>
                        <option value="">—</option>
                        <option value="true">yes</option>
                        <option value="false">no</option>
                    </select>
                </label>
            {/if}
        {:else}
            <label>
                <span>
                    <code>{field.name}</code>
                    <small>
                        {field.uiType ? FIELD_TYPE_LABELS[field.uiType] : field.surrealType}
                        {field.required ? '· required' : ''}
                    </small>
                </span>
                {#if field.uiType === 'long_text'}
                    <textarea
                        bind:value={draft[field.name] as string}
                        rows="5"
                        required={field.required}></textarea>
                {:else if field.uiType === 'number'}
                    <input
                        type="number"
                        step="any"
                        bind:value={draft[field.name] as string}
                        required={field.required}
                    />
                {:else if field.uiType === 'datetime'}
                    <input
                        type="datetime-local"
                        bind:value={draft[field.name] as string}
                        required={field.required}
                    />
                {:else}
                    <input bind:value={draft[field.name] as string} required={field.required} />
                {/if}
            </label>
        {/if}
    {/each}

    {#if skipped.length > 0}
        <p class="muted">
            Not editable here (unsupported type):
            {skipped.map((f) => `${f.name} (${f.surrealType})`).join(', ')}
        </p>
    {/if}

    {#if refError !== null}
        <p class="error">{refError}</p>
    {/if}
    {#if error !== null}
        <p class="error">{error}</p>
    {/if}

    <button type="submit" disabled={busy}>{submitLabel}</button>
</form>

<style>
    form {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        max-width: 28rem;
    }

    label {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        font-size: 0.9rem;
    }

    label.inline {
        flex-direction: row;
        align-items: center;
        gap: 0.4rem;
    }

    label > span {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
    }

    small {
        color: #666;
    }

    input:not([type='checkbox']),
    select,
    textarea {
        font: inherit;
        padding: 0.4rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    textarea {
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
        margin: 0;
        color: #666;
        font-size: 0.85rem;
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
