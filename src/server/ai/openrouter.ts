// Reusable OpenRouter client (server-only).
//
// Transport strategy (verified in this environment, 2026-10-06):
//   - Direct access to openrouter.ai is blocked (403); a local proxy is required.
//   - With a proxy we install a custom SDK `HTTPClient` whose `fetcher`
//     RECONSTRUCTS the request and calls `undici.fetch(url, { method, headers,
//     body, dispatcher })`. Passing the SDK `Request` straight to
//     `undici.fetch(req, { dispatcher })` fails (double realm -> "Failed to
//     parse URL from [object Request]"), and the global `fetch(req, {
//     dispatcher })` ignores `dispatcher` (goes direct).
//   - Without a proxy we let the SDK use native fetch (no `undici` import).
//
// The API key is read once from `process.env` and is NEVER logged or returned.

import { HTTPClient, OpenRouter } from "@openrouter/sdk";
import type { Fetcher } from "@openrouter/sdk";
import type { ChatRequest } from "@openrouter/sdk/models";

/** OpenRouter request plugins (SDK union, incl. `WebSearchPlugin { id: "web" }`). */
export type ChatPlugin = NonNullable<ChatRequest["plugins"]>[number];

const DEFAULT_TEXT_MODEL = "deepseek/deepseek-v4.1-flash";
const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_APP_URL = "http://localhost:5173";
const DEFAULT_APP_TITLE = "Confi";
const REQUEST_TIMEOUT_MS = 90_000;
const PROXY_REQUEST_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 1;

/** Thrown when no API key is configured (endpoints map this to 503). */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("ai_not_configured");
    this.name = "AiNotConfiguredError";
  }
}

/** Thrown when the model call/parse fails (endpoints map this to 502). */
export class AiRequestError extends Error {
  constructor(message = "ai_failed") {
    super(message);
    this.name = "AiRequestError";
  }
}

/** True when an OpenRouter API key is present in the environment. */
export function isAiConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

/** Resolve the proxy URL from the supported environment variables. */
function proxyUrl(): string | undefined {
  const raw =
    process.env.OPENROUTER_PROXY ??
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY;
  return raw?.trim() || undefined;
}

/** Text model id (env override, otherwise a cheap default). */
export function getTextModel(): string {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

/** Image-search model id (env override, otherwise the text default). */
export function getImageModel(): string {
  return process.env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

/** Build the SDK `HTTPClient` used in proxy mode (dynamic `undici` import). */
async function createProxyHttpClient(proxy: string): Promise<HTTPClient> {
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const dispatcher = new ProxyAgent(proxy);
  const fetcher: Fetcher = async (input) => {
    const req = input instanceof Request ? input : new Request(input);
    const body =
      req.method === "GET" || req.method === "HEAD"
        ? undefined
        : Buffer.from(await req.arrayBuffer());
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key] = value;
    });
    const res = await undiciFetch(req.url, {
      method: req.method,
      headers,
      body,
      dispatcher,
      signal: AbortSignal.timeout(PROXY_REQUEST_TIMEOUT_MS),
    });
    return res as unknown as Response;
  };
  return new HTTPClient({ fetcher });
}

let cachedClient: OpenRouter | null = null;

/**
 * Lazy singleton `OpenRouter` client. Throws `AiNotConfiguredError` without a key.
 * In proxy mode the `undici` module is imported lazily so a no-proxy deployment
 * never loads it.
 */
export async function getClient(): Promise<OpenRouter> {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new AiNotConfiguredError();

  const client = new OpenRouter({
    apiKey,
    httpReferer: process.env.OPENROUTER_APP_URL?.trim() || DEFAULT_APP_URL,
    appTitle: process.env.OPENROUTER_TITLE?.trim() || DEFAULT_APP_TITLE,
    timeoutMs: REQUEST_TIMEOUT_MS,
    ...(proxyUrl() ? { httpClient: await createProxyHttpClient(proxyUrl()!) } : {}),
  });
  cachedClient = client;
  return client;
}

interface ChatMessageLike {
  message?: { content?: unknown };
}

/** Flatten an assistant message content (string or content-part array) to text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === "object" && "text" in part) {
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        }
        return "";
      })
      .join("");
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an error is worth retrying: network/timeout failures and transient
 * HTTP statuses (408/425/429/5xx). Auth/validation/4xx errors fail fast.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof AiRequestError) return false;
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  if (typeof status === "number") {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === "string" && /(connection|timeout|abort|socket|fetch)/i.test(name)) {
    return true;
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /(ECONN|ETIMEDOUT|EAI_AGAIN|UND_ERR)/i.test(code)) {
    return true;
  }
  return false;
}

export interface ChatInput {
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  /** Optional OpenRouter plugins (e.g. the web-search plugin `{ id: "web" }`). */
  plugins?: ChatPlugin[];
}

/**
 * Run a non-streaming chat completion and return the assistant text.
 * Retries transient (network/5xx/429) failures up to `MAX_RETRIES` times and
 * fails fast on auth/validation errors. The key is never logged.
 */
export async function chatComplete(input: ChatInput): Promise<string> {
  const client = await getClient();
  const model = input.model ?? getTextModel();
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = (await client.chat.send({
        chatRequest: {
          model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          temperature: input.temperature ?? 0.2,
          stream: false,
          ...(input.plugins ? { plugins: input.plugins } : {}),
        },
      })) as { choices?: ChatMessageLike[] };
      const text = contentToText(result.choices?.[0]?.message?.content);
      if (!text.trim()) throw new AiRequestError("empty_response");
      return text;
    } catch (err) {
      lastError = err;
      if (err instanceof AiNotConfiguredError) throw err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await sleep(400 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  if (lastError instanceof AiRequestError) throw lastError;
  throw new AiRequestError();
}

/**
 * Extract a JSON document from a model response, tolerating ```json fences and
 * surrounding prose. Throws `AiRequestError` when no valid JSON can be parsed.
 */
export function parseJsonFromText<T = unknown>(text: string): T {
  const trimmed = (text ?? "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate) as T;
  } catch {
    /* fall through to bracket extraction */
  }

  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ] as const) {
    const start = candidate.indexOf(open);
    const end = candidate.lastIndexOf(close);
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        /* keep trying */
      }
    }
  }
  throw new AiRequestError("invalid_json");
}

/** Run a chat completion and parse its response as JSON. */
export async function chatJson<T>(input: ChatInput): Promise<T> {
  return parseJsonFromText<T>(await chatComplete(input));
}