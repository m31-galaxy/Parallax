<script lang="ts">
    import ValueEditor, { type RefOption } from './ValueEditor.svelte';
    import { getClass, referenceTargets, typeLabel, type FieldView } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
    import { fromDraft, listObjects, objectLabel, toDraft, type DraftValue } from '$lib/db/objects';

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

    const editable = $derived(fields.filter((f) => f.type !== undefined));
    const skipped = $derived(fields.filter((f) => f.type === undefined));

    // Intentional init-time snapshot: the form owns its draft, and parents
    // remount the component when the target record changes.
    // svelte-ignore state_referenced_locally
    let draft = $state<Record<string, DraftValue>>(
        Object.fromEntries(
            fields
                .filter((f) => f.type !== undefined)
                .map((f) => [f.name, toDraft(f.type!, initial[f.name], f.required)])
        )
    );

    // Reference picker options, shared across fields by target class and
    // loaded once per mount.
    let optionsByTarget = $state<Record<string, RefOption[]>>({});
    let refError = $state<string | null>(null);

    $effect(() => {
        const targets = new Set(fields.flatMap((f) => (f.type ? referenceTargets(f.type) : [])));
        for (const target of targets) void loadTargetOptions(target);
    });

    async function loadTargetOptions(target: string): Promise<void> {
        try {
            const targetClass = await getClass(connection.client, target);
            const records = await listObjects(connection.client, target);
            optionsByTarget[target] = records.map((record) => ({
                value: String(record.id),
                label: objectLabel(targetClass, record)
            }));
        } catch (err) {
            refError = err instanceof Error ? err.message : String(err);
            optionsByTarget[target] = [];
        }
    }

    function submit(): void {
        const data: Record<string, unknown> = {};
        for (const field of editable) {
            const value = fromDraft(field.type!, draft[field.name], field.required);
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
        <label class:inline={field.type?.kind === 'boolean' && field.required}>
            <span>
                <code>{field.name}</code>
                <small>
                    {field.type ? typeLabel(field.type) : field.surrealType}
                    {field.required ? '· required' : ''}
                </small>
            </span>
            <ValueEditor
                type={field.type!}
                bind:draft={draft[field.name]}
                required={field.required}
                {optionsByTarget}
            />
        </label>
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
        flex-direction: row-reverse;
        justify-content: flex-end;
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
