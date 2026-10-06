// Shared image-upload constants used by both the client form and the server
// upload endpoint, so the allowlist and size limit cannot drift apart.
// SVG is deliberately excluded (XSS risk); only raster formats are allowed.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Allowed image MIME type -> canonical file extension. */
export const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const ALLOWED_IMAGE_MIME_TYPES = Object.keys(IMAGE_MIME_EXT);

/** Value for an `<input type="file">` accept attribute. */
export const ALLOWED_IMAGE_ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(",");