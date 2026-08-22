/**
 * Connection profiles, persisted to localStorage (spec §8).
 *
 * Passwords are stored only when the user opts in per profile ("remember
 * password"), in plaintext — the connect UI carries the warning. Passwords
 * never appear in URLs or query strings.
 */

import { SvelteDate } from 'svelte/reactivity';
import type { AuthLevel } from './auth';

export type { AuthLevel };

export interface ConnectionProfile {
    id: string;
    name: string;
    url: string;
    /** Namespace holding this profile's databases. Defaults to 'parallax' (spec §8). */
    namespace: string;
    auth: {
        level: AuthLevel;
        /** Unset for anonymous. */
        username?: string;
    };
    /** Database-level credentials are bound to a single database. */
    database?: string;
    rememberPassword: boolean;
    /** Present only when rememberPassword is true. */
    password?: string;
    /** Database to reopen on auto-reconnect. */
    lastDatabase?: string;
    lastUsedAt?: string;
}

export const DEFAULT_NAMESPACE = 'parallax';

const STORAGE_KEY = 'parallax:profiles:v1';

interface PersistedState {
    profiles: ConnectionProfile[];
    lastActiveProfileId: string | null;
}

function load(): PersistedState {
    const empty: PersistedState = { profiles: [], lastActiveProfileId: null };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return empty;
    try {
        const parsed = JSON.parse(raw) as PersistedState;
        if (!Array.isArray(parsed.profiles)) throw new Error('profiles is not an array');
        return {
            profiles: parsed.profiles,
            lastActiveProfileId: parsed.lastActiveProfileId ?? null
        };
    } catch (err) {
        // A corrupt store is unrecoverable; start fresh but leave a trace.
        console.error('Parallax: discarding unreadable profile store', err);
        return empty;
    }
}

const state = $state<PersistedState>(load());

function persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify($state.snapshot(state)));
}

export const profiles = {
    get all(): ConnectionProfile[] {
        return state.profiles;
    },

    get lastActive(): ConnectionProfile | undefined {
        return state.profiles.find((p) => p.id === state.lastActiveProfileId);
    },

    byId(id: string): ConnectionProfile | undefined {
        return state.profiles.find((p) => p.id === id);
    },

    /** Insert or update; strips the password unless rememberPassword is set. */
    save(profile: ConnectionProfile): void {
        const cleaned: ConnectionProfile = {
            ...profile,
            password: profile.rememberPassword ? profile.password : undefined
        };
        const index = state.profiles.findIndex((p) => p.id === cleaned.id);
        if (index === -1) state.profiles.push(cleaned);
        else state.profiles[index] = cleaned;
        persist();
    },

    remove(id: string): void {
        state.profiles = state.profiles.filter((p) => p.id !== id);
        if (state.lastActiveProfileId === id) state.lastActiveProfileId = null;
        persist();
    },

    /** Record a successful connect (and optionally the opened database). */
    markUsed(id: string, database?: string): void {
        state.lastActiveProfileId = id;
        const profile = state.profiles.find((p) => p.id === id);
        if (profile) {
            profile.lastUsedAt = new SvelteDate().toISOString();
            if (database !== undefined) profile.lastDatabase = database;
        }
        persist();
    }
};
