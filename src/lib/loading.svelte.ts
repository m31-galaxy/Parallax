/**
 * Delayed loading indicator (spec §7 perceived-performance decision):
 * navigation keeps showing the previous content; the loading state only
 * appears if a load outlives the grace window. Fast loads swap straight
 * from stale to fresh content with no flash.
 */

export const LOADING_DELAY_MS = 50;

export class DelayedLoading {
    #pending = $state(false);
    #timer: ReturnType<typeof setTimeout> | null = null;

    /** True once a started load has exceeded the grace window. */
    get pending(): boolean {
        return this.#pending;
    }

    start(): void {
        this.#clear();
        this.#timer = setTimeout(() => (this.#pending = true), LOADING_DELAY_MS);
    }

    finish(): void {
        this.#clear();
        this.#pending = false;
    }

    #clear(): void {
        if (this.#timer !== null) clearTimeout(this.#timer);
        this.#timer = null;
    }
}
