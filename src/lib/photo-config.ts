// Every size, quality and limit for site photos, in one place. Import-free so the browser, the routes
// and the node tests all read the same numbers.

export const PHOTO_BUCKET = "job-photos";

// Thumbnail: long edge ~300 px, JPEG, aiming under 20 KB.
export const THUMB_MAX_EDGE = 300;
export const THUMB_TARGET_BYTES = 20 * 1024;
export const THUMB_QUALITIES = [0.7, 0.6, 0.5, 0.4, 0.3] as const;

// Display image: long edge ~1,600 px, JPEG, quality stepped down until it fits ~250 KB.
export const DISPLAY_MAX_EDGE = 1600;
export const DISPLAY_TARGET_BYTES = 250 * 1024;
export const DISPLAY_QUALITIES = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.35] as const;

// If even the lowest quality is over the target, the long edge shrinks by this factor and the quality
// ladder is tried again (up to this many times).
export const SHRINK_FACTOR = 0.8;
export const MAX_SHRINKS = 3;

// What the SERVER accepts (the client aims lower). The bucket itself refuses > 500 KB.
export const MAX_DISPLAY_BYTES = 400 * 1024;
export const MAX_THUMB_BYTES = 64 * 1024;

export const MAX_CAPTION_LENGTH = 200;

// How long a signed URL works. Short on purpose: the gallery asks again when one lapses.
export const PHOTO_URL_EXPIRY_SECONDS = 15 * 60;

// Photos picked in one go (the form uploads them one at a time).
export const MAX_PHOTOS_PER_BATCH = 20;
