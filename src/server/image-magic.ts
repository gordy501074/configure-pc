// Shared image-format helpers used by the upload endpoint and the AI image
// downloader so the allowlist and magic-byte checks cannot drift apart.

import { IMAGE_MIME_EXT } from "../lib/imageUpload.ts";

/**
 * Allowed file extension -> served MIME type, derived from the single shared
 * `IMAGE_MIME_EXT` allowlist (MIME -> ext) so the two views cannot diverge.
 * `jpeg` is kept as an alias extension for compatibility. SVG is excluded.
 */
export const UPLOAD_EXT_MIME: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [mime, ext] of Object.entries(IMAGE_MIME_EXT)) map[ext] = mime;
  map.jpeg = "image/jpeg";
  return map;
})();

/** Extensions understood by `matchesMagic` (canonical, in sniff order). */
export const MAGIC_EXTENSIONS = ["png", "jpg", "gif", "webp"] as const;

/** Verify magic bytes for an allowlisted raster format (SVG deliberately excluded). */
export function matchesMagic(buf: Buffer, ext: string): boolean {
  if (buf.length < 12) return false;
  switch (ext) {
    case "png":
      return (
        buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
        buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
      );
    case "jpg":
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "gif":
      return buf.toString("latin1", 0, 6) === "GIF87a" || buf.toString("latin1", 0, 6) === "GIF89a";
    case "webp":
      return (
        buf.toString("latin1", 0, 4) === "RIFF" &&
        buf.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}