// Component AI tasks: short RU description + web image search with a safe
// downloader. Built on the reusable OpenRouter client (chatJson).
//
// `streamComponentImages` asks the model for product-page URLs, then walks them
// server-side: each page's `og:image` is SSRF-validated, fetched with a
// redirect/size/timeout budget, checked for image magic bytes, and only then
// written to disk. Progress is yielded as NDJSON-friendly events so the client
// can show live thumbnails, a countdown and a Stop button.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Agent, fetch as undiciFetch } from "undici";
import { MAX_IMAGE_BYTES } from "../../lib/imageUpload.ts";
import { MAGIC_EXTENSIONS, matchesMagic, UPLOAD_EXT_MIME } from "../image-magic.ts";
import { resolveSafeUrl, type SafeAddress } from "./ssrf.ts";
import {
  chatComplete,
  chatJson,
  getImageModel,
  getTextModel,
  AiNotConfiguredError,
  AiRequestError,
} from "./openrouter.ts";

/** Input shared by both AI component tasks (all fields optional, user-supplied). */
export interface ComponentAiInput {
  category?: string;
  name?: string;
  brand?: string;
  specs?: string;
}

const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 15_000;
/** Hard deadline for the whole multi-candidate image search (up to 5 downloads). */
const IMAGE_SEARCH_DEADLINE_MS = 45_000;
/** Maximum number of product pages / downloaded candidates per search. */
const MAX_IMAGE_CANDIDATES = 5;
/** Browser-like UA: several image CDNs reject requests without one. */
const DOWNLOAD_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Human-readable component facts for a prompt (no invented data). */
function factsLine(input: ComponentAiInput): string {
  const parts = [
    clean(input.category) && `Категория: ${clean(input.category)}`,
    clean(input.brand) && `Бренд: ${clean(input.brand)}`,
    clean(input.name) && `Модель: ${clean(input.name)}`,
    clean(input.specs) && `Характеристики: ${clean(input.specs)}`,
  ].filter(Boolean) as string[];
  return parts.join("\n");
}

/**
 * Generate a 1-2 sentence Russian description for a component card. Only the
 * supplied facts may be used (no fabricated numbers).
 */
export async function describeComponent(input: ComponentAiInput): Promise<string> {
  const system =
    "Ты помогаешь заполнить карточку компьютерного комплектующего. " +
    "Напиши краткое описание на русском языке: 1–2 предложения, по делу, без маркетинговых " +
    "преувеличений и БЕЗ выдуманных характеристик. Используй только переданные данные " +
    "(категория, бренд, модель, характеристики). Не добавляй цифры, которых нет во входных данных.";
  const user = factsLine(input) || "Комплектующее без дополнительных данных.";
  const text = await chatComplete({ system, user, model: getTextModel(), temperature: 0.4 });
  const description = text.replace(/\s+/g, " ").trim();
  if (!description) throw new AiRequestError("empty_response");
  return description;
}

interface PageSearchResult {
  pages?: unknown;
}

/** Map a URL's extension (when usable) to an allowlisted format. */
function extFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const match = /\.([a-z0-9]+)$/i.exec(path);
    if (!match) return null;
    const ext = match[1].toLowerCase();
    return UPLOAD_EXT_MIME[ext] ? ext : null;
  } catch {
    return null;
  }
}

/** Sniff a supported extension from the leading magic bytes of a buffer. */
function extFromMagic(buf: Buffer): string | null {
  for (const ext of MAGIC_EXTENSIONS) {
    if (matchesMagic(buf, ext)) return ext;
  }
  return null;
}

/** Progress event yielded by `streamComponentImages` (one NDJSON line each). */
export type ImageEvent =
  | { event: "start"; deadlineMs: number }
  | { event: "phase"; phase: "search_pages" }
  | { event: "phase"; phase: "download"; pages: number }
  | { event: "candidate"; url: string; index: number }
  | { event: "done"; urls: string[] }
  | { event: "error"; error: "ai_not_configured" | "ai_failed" };

export interface StreamImageOptions {
  /** Aborted when the client connection closes. */
  signal?: AbortSignal;
}

/** Reject as soon as `signal` aborts, racing an in-flight promise. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Find product photos: the model returns product-page URLs, we extract
 * `og:image` from each page and download up to `MAX_IMAGE_CANDIDATES` valid
 * images. Yields progress events; always finishes with `done` (or `error`).
 *
 * Asking for "page URLs" is far more reliable than direct image URLs (models
 * hallucinate image filenames). Each candidate is a served `/api/uploads/<file>`
 * URL that remains on disk until the client discards or the admin prunes it.
 */
export async function* streamComponentImages(
  input: ComponentAiInput,
  uploadsDir: string,
  opts: StreamImageOptions = {},
): AsyncGenerator<ImageEvent> {
  yield { event: "start", deadlineMs: IMAGE_SEARCH_DEADLINE_MS };
  yield { event: "phase", phase: "search_pages" };

  const controller = new AbortController();
  const abortAll = () => controller.abort();
  const deadline = setTimeout(abortAll, IMAGE_SEARCH_DEADLINE_MS);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", abortAll, { once: true });
  }

  const urls: string[] = [];
  const seen = new Set<string>();
  try {
    let pages: string[] = [];
    try {
      const system =
        "Ты ищешь фотографию компьютерного комплектующего в интернете. " +
        "Найди страницы интернет-магазинов или сайтов с фотографией именно этого товара. " +
        'Верни СТРОГО JSON вида {"pages":["https://...", ...]} ' +
        "с 5 URL страниц товара (это HTML-страницы, НЕ ссылки на изображения).";
      const user = factsLine(input) || "Комплектующее без дополнительных данных.";
      // The client abort and the overall deadline must also bound the
      // opaque model call, which otherwise runs to the SDK's own 90s timeout.
      const result = await abortable(
        chatJson<PageSearchResult>({
          system,
          user,
          model: getImageModel(),
          temperature: 0.2,
          plugins: [{ id: "web" }],
        }),
        controller.signal,
      );
      pages = Array.isArray(result.pages)
        ? result.pages.filter(
            (p): p is string => typeof p === "string" && p.startsWith("https://"),
          )
        : [];
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        yield { event: "error", error: "ai_not_configured" };
        return;
      }
      // Deadline or client disconnect during the model call: finish cleanly
      // with whatever we have (nothing yet).
      if (controller.signal.aborted) {
        yield { event: "done", urls };
        return;
      }
      yield { event: "error", error: "ai_failed" };
      return;
    }

    if (controller.signal.aborted) {
      yield { event: "done", urls };
      return;
    }

    const pageList = pages.slice(0, MAX_IMAGE_CANDIDATES);
    yield { event: "phase", phase: "download", pages: pageList.length };

    for (const page of pageList) {
      if (controller.signal.aborted) break;
      if (urls.length >= MAX_IMAGE_CANDIDATES) break;
      try {
        const imageUrl = await fetchPageImageUrl(page, controller.signal);
        if (!imageUrl) continue;
        const url = await downloadAndSaveImage(imageUrl, uploadsDir, controller.signal);
        if (url && !seen.has(url)) {
          seen.add(url);
          urls.push(url);
          yield { event: "candidate", url, index: urls.length };
        }
      } catch {
        // Page/image invalid, unreachable or aborted: try the next one.
      }
    }
    yield { event: "done", urls };
  } finally {
    clearTimeout(deadline);
    opts.signal?.removeEventListener("abort", abortAll);
  }
}

/**
 * DNS-pinning agent: `connect` resolves to the already-validated address while
 * `servername`/Host stay the real hostname, so TLS SNI and certificate
 * validation still target the URL host. This closes the DNS-rebinding window
 * between validation and the actual fetch.
 */
function pinningAgent(addresses: SafeAddress[], hostname: string): Agent | undefined {
  if (addresses.length === 0) return undefined;
  const chosen = addresses[0];
  return new Agent({
    connect: {
      // `lookup` is consulted by undici's connector; pinning it to the checked
      // address means no second, unvalidated DNS resolution can occur. Node 24
      // enables `autoSelectFamily` and calls `lookup` with `{ all: true }`,
      // which expects an ARRAY of addresses (a bare address string raises
      // ERR_INVALID_IP_ADDRESS), so both call shapes are handled.
      lookup: (_hostname, options, callback) => {
        const entry = { address: chosen.address, family: chosen.family };
        if (options && (options as { all?: boolean }).all) {
          callback(null, [entry] as never);
        } else {
          callback(null, entry.address, entry.family);
        }
      },
      servername: hostname,
    },
  });
}

/**
 * Download one candidate image safely (https-only, public-IP-only after DNS
 * with the connection pinned to the validated address, ≤3 redirects, timeout,
 * ≤5 MB, image/* + magic-bytes) and store it under `uploadsDir`. Returns the
 * served `/api/uploads/<file>` URL.
 */
export async function downloadAndSaveImage(
  rawUrl: string,
  uploadsDir: string,
  outerSignal?: AbortSignal,
): Promise<string> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, addresses } = await resolveSafeUrl(current);
    const dispatcher = pinningAgent(addresses, url.hostname);
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, timeout])
      : timeout;
    try {
      const res = await undiciFetch(url, {
        redirect: "manual",
        signal,
        headers: {
          Accept: "image/*",
          "User-Agent": DOWNLOAD_USER_AGENT,
          Referer: `${url.origin}/`,
        },
        ...(dispatcher ? { dispatcher } : {}),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error("bad_redirect");
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok) throw new Error("download_failed");

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("image/")) throw new Error("not_an_image");

      const declared = Number(res.headers.get("content-length") ?? "0");
      if (declared > MAX_IMAGE_BYTES) throw new Error("file_too_large");

      const buffer = await readLimited(res, MAX_IMAGE_BYTES);
      const ext = extFromMagic(buffer) ?? extFromUrl(current);
      if (!ext || !matchesMagic(buffer, ext)) throw new Error("invalid_file");

      const file = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      await writeFile(join(uploadsDir, file), buffer);
      return `/api/uploads/${file}`;
    } finally {
      void dispatcher?.close();
    }
  }
  throw new Error("too_many_redirects");
}

/** Minimal body reader shared by DOM and undici Responses. */
type BodyReadable = Pick<Response, "arrayBuffer"> & {
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(reason?: unknown): Promise<void>;
    };
  } | null;
};

/** Read a response body, aborting once `limit` bytes are exceeded. */
async function readLimited(res: BodyReadable, limit: number): Promise<Buffer> {
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > limit) throw new Error("file_too_large");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("file_too_large");
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

const MAX_HTML_BYTES = 512 * 1024;

/**
 * Fetch an HTML page (SSRF-validated, DNS-pinned, redirect/size/timeout
 * bounded) and extract its `og:image` / `twitter:image` URL. Returns null when
 * the page is unreachable or declares no image. Used because models reliably
 * know product *page* URLs but rarely the exact image URL.
 */
export async function fetchPageImageUrl(
  rawUrl: string,
  outerSignal?: AbortSignal,
): Promise<string | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, addresses } = await resolveSafeUrl(current);
    const dispatcher = pinningAgent(addresses, url.hostname);
    const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, timeout])
      : timeout;
    try {
      const res = await undiciFetch(url, {
        redirect: "manual",
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": DOWNLOAD_USER_AGENT,
        },
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = new URL(location, url).toString();
        continue;
      }
      if (!res.ok) return null;
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("html")) return null;
      const html = (await readLimited(res, MAX_HTML_BYTES)).toString("utf8");
      return extractOgImage(html);
    } finally {
      void dispatcher?.close();
    }
  }
  return null;
}

/** Pull the first `og:image` / `twitter:image` URL out of an HTML document. */
export function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url|:url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url|:url)?["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m) {
      const raw = m[1].trim();
      if (raw.startsWith("https://")) return raw;
    }
  }
  return null;
}

