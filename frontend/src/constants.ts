/** Must match backend `CHUNK_SIZE`. */
export const CHUNK_SIZE = 32;

/** Logical cell size in CSS pixels at scale 1. */
export const BASE_CELL_PX = 28;

export const CHUNK_BUFFER = 12;
export const CHUNK_DIRECTION_EXTRA = 4;
/** Debounce shrinking the retention zone (unsubscribe only). Subscribe is immediate. */
export const BUFFER_DEBOUNCE_MS = 150;
/** Hard cap on server chunk subscriptions per client (evict farthest when exceeded). */
export const MAX_SUBSCRIBED_CHUNKS = 500;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;
