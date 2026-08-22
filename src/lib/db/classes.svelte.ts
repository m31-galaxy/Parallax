/**
 * Reactive class list for the sidebar. All pure class logic lives in
 * ./classes; this module only adds the runes store on top and re-exports
 * the rest so Svelte code has a single import path.
 */

import { listClasses, type ClassSummary } from './classes';
import { connection } from './connection.svelte';

export * from './classes';

let classes = $state<ClassSummary[]>([]);
let loaded = $state(false);
let listError = $state<string | null>(null);

export const classStore = {
    get all(): ClassSummary[] {
        return classes;
    },
    get loaded(): boolean {
        return loaded;
    },
    get error(): string | null {
        return listError;
    },

    async refresh(): Promise<void> {
        try {
            classes = await listClasses(connection.client);
            listError = null;
        } catch (err) {
            classes = [];
            listError = err instanceof Error ? err.message : String(err);
        }
        loaded = true;
    },

    clear(): void {
        classes = [];
        loaded = false;
        listError = null;
    }
};
