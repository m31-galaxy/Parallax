<script lang="ts">
    import TypePicker from './TypePicker.svelte';
    import {
        defaultFieldType,
        FIELD_KIND_LABELS,
        FIELD_KINDS,
        type FieldKind,
        type FieldType
    } from '$lib/db/classes.svelte';

    interface Props {
        type: FieldType;
        /** Classes a reference may target. */
        targets: string[];
    }

    let { type = $bindable(), targets }: Props = $props();

    function setKind(kind: FieldKind): void {
        if (kind === type.kind) return;
        if (kind === 'reference') type = { kind, target: '' };
        else if (kind === 'list') type = { kind, element: defaultFieldType() };
        else type = { kind };
    }
</script>

<span class="type-picker">
    <select
        value={type.kind}
        aria-label="Field type"
        onchange={(event) => setKind(event.currentTarget.value as FieldKind)}
    >
        {#each FIELD_KINDS as kind (kind)}
            <option value={kind}>{FIELD_KIND_LABELS[kind]}</option>
        {/each}
    </select>
    {#if type.kind === 'reference'}
        <select bind:value={type.target} aria-label="Reference target class">
            <option value="" disabled>Target class…</option>
            {#each targets as target (target)}
                <option value={target}>{target}</option>
            {/each}
        </select>
    {:else if type.kind === 'list'}
        <span class="of">of</span>
        <TypePicker bind:type={type.element} {targets} />
    {/if}
</span>

<style>
    .type-picker {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
        flex-wrap: wrap;
    }

    select {
        font: inherit;
        padding: 0.4rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
    }

    .of {
        color: #666;
        font-size: 0.9rem;
    }
</style>
