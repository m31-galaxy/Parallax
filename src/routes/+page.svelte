<script lang="ts">
    import { connection } from '$lib/db/connection.svelte';
</script>

<main>
    <h1>{connection.database}</h1>
    <p>This database has no classes yet. The class designer is the next v0.1 milestone item.</p>
</main>

<style>
    main {
        max-width: 34rem;
        margin: 0 auto;
        padding: 2rem 1rem;
    }

    h1 {
        font-size: 1.4rem;
    }

    p {
        color: #666;
    }
</style>
