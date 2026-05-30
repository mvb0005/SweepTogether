/** Must match backend `CHUNK_SIZE`. */
export const CHUNK_SIZE = 32;

/** Logical cell size in CSS pixels at scale 1. */
export const BASE_CELL_PX = 28;

export const CHUNK_BUFFER = 4;
export const CHUNK_DIRECTION_EXTRA = 4;
/** Debounce shrinking the retention zone (unsubscribe only). Subscribe is immediate. */
export const BUFFER_DEBOUNCE_MS = 150;
/** Hard cap on server chunk subscriptions per client (evict farthest when exceeded). */
export const MAX_SUBSCRIBED_CHUNKS = 150;
/** Max chunk payloads kept in client memory for rendering. */
export const MAX_CLIENT_CHUNKS = 150;
/** Re-subscribe visible chunks if no wire data within this window. */
export const CHUNK_LOAD_TIMEOUT_MS = 2500;
/** Max re-subscribe attempts per chunk while still visible. */
export const CHUNK_RETRY_MAX = 3;
/** How often to scan for stale pending chunks. */
export const CHUNK_RETRY_INTERVAL_MS = 800;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 4;

/** Remote players glide between cells over this duration. Self snaps instantly. */
export const MOVE_ANIM_MS = 50;
/** Minimum ms between move inputs (client + server). */
export const INPUT_COOLDOWN_MS = 50;
/** @deprecated use INPUT_COOLDOWN_MS */
export const MOVE_COOLDOWN_MS = INPUT_COOLDOWN_MS;
/** Camera tracks the local player instantly. */
export const CAMERA_FOLLOW_MS = 0;
