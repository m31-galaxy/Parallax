<script lang="ts">
    import { resolve } from '$app/paths';
    import { classStore } from '$lib/db/classes.svelte';
    import { connection } from '$lib/db/connection.svelte';
</script>

<main>
    <h1>{connection.database}</h1>
    {#if classStore.loaded && classStore.all.length === 0}
        <p>
            This database has no classes yet.
            <a href={resolve('/classes/new')}>Create your first class</a> to give it structure.
        </p>
    {:else}
        <p>Select a class from the sidebar, or <a href={resolve('/classes/new')}>create one</a>.</p>
    {/if}
</main>

<style>
    main {
        max-width: 34rem;
        padding: 2rem 1.5rem;
    }

    h1 {
        font-size: 1.4rem;
    }

    p {
        color: #666;
    }
</style>
