// AI advisor orchestration: turns a chat turn into an NDJSON `AdvisorStreamEvent`
// stream. The LLM drives the dialog and extracts structured requirements; a
// deterministic engine (`src/lib/aiAdvisor.ts`) maps those onto real catalog
// data/prices. Only visible model text is streamed; the JSON envelope is
// separated and never shown.

import {
  chatComplete,
  chatStream,
  getChatModel,
  parseJsonFromText,
  AiNotConfiguredError,
} from "./openrouter.ts";
import {
  formatPartsText,
  normalizeRequirements,
  recommend,
} from "../../lib/aiAdvisor.ts";
import type { AdvisorCatalog } from "../../lib/aiAdvisor.ts";
import type {
  AdvisorMessage,
  AdvisorRequirements,
  AdvisorStreamEvent,
} from "../../types/index.ts";

/** Build the full catalog (ready builds + orderable parts) for a seller. */
interface AdvisorCatalogLoader {
  (sellerId: string): Promise<AdvisorCatalog>;
}

interface AdvisorChatDeps {
  loadCatalog: AdvisorCatalogLoader;
}

interface AdvisorChatInput {
  /** Full chat history incl. the newest user message. */
  messages: AdvisorMessage[];
  /** Seller whose active price list drives prices. */
  sellerId?: string;
  /** Requirements collected on earlier turns (untrusted; normalized here). */
  known?: unknown;
  /** Abort the model call when the client disconnects. */
  signal?: AbortSignal;
}

const ADVISOR_DEADLINE_MS = 45_000;

/** User phrases that explicitly ask to assemble / show a build now. */
const BUILD_REQUEST_RE =
  /(собер|собрат|подбер|подобрат|предлож|покаж|кастом|из комплектующ|конфигурац)/i;

/** Usage options the model can pick from. */
const USAGE_OPTIONS = ["gaming", "work", "video", "universal"];

/** System prompt — keeps the model on tracking requirement extraction. */
function buildSystemPrompt(known: AdvisorRequirements): string {
  const usageLabels: Record<string, string> = {
    gaming: "игры",
    work: "работа/офис",
    video: "видеомонтаж, 3D",
    universal: "универсально",
  };
  const usageLine = USAGE_OPTIONS.map((u) => `${u} = ${usageLabels[u]}`).join(", ");
  return [
    "Ты — эксперт-помощник по подбору персонального компьютера в онлайн-конфигураторе.",
    "Веди короткий диалог на русском языке. Узнай по порядку:",
    "  1) бюджет (в рублях);",
    "  2) назначение (игры, работа/офис, видеомонтаж/3D, универсально);",
    "  3) профессию или хобби (чем занимается пользователь);",
    "  4) приоритеты: тишина / производительность / цена;",
    "  5) предпочтение платформы Intel или AMD.",
    "Задавай ОДИН вопрос за раз, не перегружай пользователя. Если пользователь",
    "сам уже ответил на вопрос — не переспрашивай.",
    "",
    "По умолчанию сервер собирает КАСТОМНУЮ сборку из отдельных комплектующих",
    "строго в рамках бюджета. Сам готовые сборки из витрины не предлагай и не",
    'называй. Только если пользователь прямо просит готовую — "buildType":"ready";',
    'если просит кастомную — "buildType":"custom"; иначе поле не указывай.',
    "",
    "НИКОГДА не придумывай цены и характеристики компонентов — сборку по реальному",
    "каталогу и активному прайс-листу собирает сервер и сам показывает её состав",
    "в чате. Когда данных достаточно, напиши одну короткую фразу (например,",
    "«Отлично, вот что я подобрал:») — список сервер добавит сам.",
    "Если пользователь прямо просит собрать / показать сборку и бюджет известен —",
    "НЕ задавай больше вопросов: одна короткая фраза и `ready` = true. Уточнения",
    "можно предложить после выдачи сборки.",
    "После выдачи сборки продолжай диалог: отвечай на вопросы о ней, опираясь на",
    "показанный состав, и принимай правки (бюджет, платформа, тип сборки,",
    "приоритеты) — с правками снова ставь `ready` = true.",
    "",
    "ВСЕГДА пиши хотя бы одно предложение видимого текста для пользователя ДО",
    "служебного JSON. Ответ из одного JSON недопустим.",
    "",
    `Назначение выбери строго из: ${usageLine}.`,
    ...(Object.keys(known).length > 0
      ? [`Уже известно из диалога (не переспрашивай и сохраняй в requirements): ${JSON.stringify(known)}.`]
      : []),
    "",
    "В самом конце ответа, ПОСЛЕ видимого текста, допиши служебный JSON-конверт в",
    "блоке кода ```json без пояснений:",
    '{"requirements":{"budget":<число, если известен>,"usage":"<usage>",',
    '"interests":[<строки>],"priorities":[<строки>],"ecosystem":"intel|amd",',
    '"buildType":"ready|custom"},"ready":<true|false>}.',
    "В `requirements` всегда возвращай ВСЕ требования, собранные за весь диалог.",
    "`ready` = true, когда известен бюджет и (назначение или интересы), а также",
    "когда пользователь меняет требования к уже выданной сборке.",
    "Если информации мало — `ready` = false, а в `requirements` верни то, что уже",
    "собрано (даже частично). Не выдумывай требования.",
  ].join("\n");
}

/** System prompt for the fallback requirements extraction (no dialog text). */
const EXTRACT_PROMPT = [
  "Ты извлекаешь требования к ПК из диалога пользователя с помощником.",
  "Верни ТОЛЬКО JSON без пояснений:",
  '{"requirements":{"budget":<число>,"usage":"gaming|work|video|universal",',
  '"interests":[<строки>],"priorities":[<строки>],"ecosystem":"intel|amd",',
  '"buildType":"ready|custom"},"ready":<true|false>}.',
  'Поля, о которых ничего не известно, не указывай. "buildType":"ready" — только если',
  'пользователь прямо просил готовую сборку из витрины, "buildType":"custom" — если',
  "просил кастомную / из комплектующих. `ready` = true, когда",
  "известен бюджет и (назначение или интересы).",
].join("\n");

type Envelope = { requirements?: unknown; ready?: boolean };

/** Fallback: ask the model for just the envelope when the reply lacked one. */
async function extractEnvelope(
  messages: AdvisorMessage[],
  signal: AbortSignal,
): Promise<Envelope | null> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Пользователь" : "Помощник"}: ${m.content}`)
    .join("\n");
  try {
    const text = await chatComplete({
      system: EXTRACT_PROMPT,
      user: transcript,
      model: getChatModel(),
      temperature: 0,
      signal,
    });
    const parsed = parseJsonFromText<Envelope>(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Deterministic chat text for a recommendation (also kept in the history). */
function recommendationText(rec: ReturnType<typeof recommend>, budget?: number): string {
  if (rec.kind === "ready") {
    return [
      `Готовая сборка «${rec.readyPc.name}»:`,
      formatPartsText(rec.readyPc.parts),
    ].join("\n");
  }
  const lines = [
    `Сборка под вас из комплектующих — ${rec.summary}:`,
    formatPartsText(rec.config.parts),
  ];
  const total = rec.config.parts.reduce((s, p) => s + (p.part?.price ?? 0), 0);
  if (budget && total > budget) {
    const fmt = (v: number) => `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
    lines.push(
      `Уложиться в ${fmt(budget)} не получилось: это самая доступная совместимая сборка по текущему прайсу. Можно увеличить бюджет или сменить платформу.`,
    );
  }
  return lines.join("\n");
}

/** Separate the trailing JSON envelope from visible model text. */
function separateEnvelope(text: string): {
  visible: string;
  envelope: Envelope | null;
} {
  const trimmed = text.trimEnd();
  const fenced =
    /```(?:json)?\s*(\{[\s\S]*?\})\s*```\s*$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : "";
  if (!candidate) {
    // No fenced envelope: keep visible text as-is.
    return { visible: trimmed, envelope: null };
  }
  if (!candidate.includes('"requirements"') && !candidate.includes('"ready"')) {
    // A fence exists but is unrelated (e.g. a code sample) — don't strip it.
    return { visible: trimmed, envelope: null };
  }
  try {
    const parsed = JSON.parse(candidate) as { requirements?: unknown; ready?: boolean };
    // `fenced` is anchored to the end, so the match index is the OPENING fence
    // (unlike a lastIndexOf, which would resolve to the closing fence and leak
    // the envelope into the visible text).
    const visible = trimmed.slice(0, fenced!.index).trimEnd();
    return { visible, envelope: parsed };
  } catch {
    // Unparseable envelope: leave text as-is (fail-safe).
    return { visible: trimmed, envelope: null };
  }
}

/**
 * Stream one advisor turn. Yields `start`, then `delta` for visible text,
 * then `requirements` (+ optional `recommendation` with its parts list as a
 * text `delta`), then `done`. Every successful turn carries visible text.
 */
export async function* streamAdvisorReply(
  input: AdvisorChatInput,
  deps: AdvisorChatDeps,
): AsyncGenerator<AdvisorStreamEvent> {
  yield { event: "start", deadlineMs: ADVISOR_DEADLINE_MS };

  const sellerId = input.sellerId?.trim() || "";
  const catalog = await deps.loadCatalog(sellerId);
  // Requirements gathered on earlier turns (sent back by the client): the model
  // tends to drop them from its envelope, so they are merged in server-side.
  const known = normalizeRequirements(input.known);
  const system = buildSystemPrompt(known);
  const history: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: system },
    ...input.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let full = "";
  let emitted = 0;
  // Enforce the advertised deadline: abort the model call(s) (and the forwarded
  // client signal) once `ADVISOR_DEADLINE_MS` elapses or the client disconnects.
  const deadlineController = new AbortController();
  let timedOut = false;
  const onClientAbort = () => deadlineController.abort();
  if (input.signal) {
    if (input.signal.aborted) deadlineController.abort();
    else input.signal.addEventListener("abort", onClientAbort, { once: true });
  }
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    deadlineController.abort();
  }, ADVISOR_DEADLINE_MS);
  try {
    try {
      for await (const delta of chatStream({
        messages: history,
        model: getChatModel(),
        temperature: 0.5,
        signal: deadlineController.signal,
      })) {
        full += delta;
        // Only surface text before the trailing fenced JSON envelope (the
        // envelope itself is never shown to the user).
        const fenceStart = full.indexOf("```");
        const visibleEnd = fenceStart >= 0 ? fenceStart : full.length;
        if (visibleEnd > emitted) {
          yield { event: "delta", text: full.slice(emitted, visibleEnd) };
          emitted = visibleEnd;
        }
      }
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        yield { event: "error", error: "ai_not_configured" };
        return;
      }
      if (!deadlineController.signal.aborted) {
        yield { event: "error", error: "ai_failed" };
        return;
      }
    }
    if (deadlineController.signal.aborted) {
      // Client disconnected: finish quietly. Deadline: tell the user.
      yield timedOut ? { event: "error", error: "ai_timeout" } : { event: "done" };
      return;
    }

    let { visible, envelope } = separateEnvelope(full);
    // Emit any visible text that wasn't streamed yet (e.g. no fence found).
    const visibleLen = visible.trimEnd().length;
    if (visibleLen > emitted && visibleLen <= full.length) {
      yield { event: "delta", text: full.slice(emitted, visibleLen) };
      emitted = visibleLen;
    }
    const hasText = full.slice(0, emitted).trim().length > 0;

    if (!envelope) {
      // The model skipped (or broke) the envelope: extract requirements with a
      // separate, cheap call over the same dialog.
      envelope = await extractEnvelope(input.messages, deadlineController.signal);
    }

    const fresh = envelope ? normalizeRequirements(envelope.requirements) : {};
    const merged: AdvisorRequirements = { ...known, ...fresh };
    const requirements = Object.keys(merged).length > 0 ? merged : null;
    if (requirements) yield { event: "requirements", data: requirements };

    // The model often keeps asking questions (`ready` = false) even after the
    // user explicitly asked for a build — honour the explicit request once the
    // budget is known.
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    // A build was already shown and the requirements changed (e.g. new budget):
    // rebuild right away instead of waiting for the model's flag.
    const buildShown = input.messages.some((m) => m.role === "assistant" && m.content.includes("Итого:"));
    const changed = JSON.stringify(known) !== JSON.stringify(requirements ?? {});
    const explicitRequest =
      !!requirements?.budget &&
      (!!requirements.usage ||
        !!requirements.interests?.length ||
        !!requirements.buildType ||
        (buildShown && changed) ||
        (!!lastUser && BUILD_REQUEST_RE.test(lastUser.content)));

    let rec: ReturnType<typeof recommend> | null = null;
    let noParts = false;
    if (
      requirements &&
      (envelope?.ready === true || explicitRequest) &&
      (requirements.budget || requirements.usage || requirements.interests?.length)
    ) {
      rec = recommend(requirements, catalog);
      // No orderable components (e.g. no seller/price list) — don't offer an
      // empty recommendation, say so instead.
      if (rec.kind === "custom" && rec.config.parts.length === 0) {
        rec = null;
        noParts = true;
      }
    }

    const recText = rec ? recommendationText(rec, requirements?.budget) : "";
    // Same build already shown earlier in this dialog: don't repeat it.
    const repeated =
      !!recText &&
      input.messages.some((m) => m.role === "assistant" && m.content.includes(recText));

    const sameBuildNote =
      "Под ваши требования подходит сборка, показанная выше. Что поменять — бюджет, назначение, платформу или приоритеты?";
    if (!hasText) {
      const fallback = rec && !repeated
        ? "Вот что я подобрал по вашим требованиям:"
        : repeated
          ? sameBuildNote
          : "Расскажите, пожалуйста, подробнее: какой у вас бюджет и для чего нужен компьютер?";
      yield { event: "delta", text: fallback };
    } else if (repeated && !!lastUser && BUILD_REQUEST_RE.test(lastUser.content)) {
      // The model may ramble or re-ask; always point at the build already shown.
      yield { event: "delta", text: `\n\n${sameBuildNote}` };
    }

    if (noParts) {
      yield {
        event: "delta",
        text: "\n\nНе получилось собрать сборку: в активном прайс-листе продавца нет комплектующих с ценами. Выберите другого продавца в каталоге или попробуйте позже.",
      };
    }

    if (rec && !repeated) {
      yield { event: "delta", text: `\n\n${recText}` };
      yield rec.kind === "ready"
        ? { event: "recommendation", kind: "ready", readyPcId: rec.readyPc.id, summary: rec.summary }
        : { event: "recommendation", kind: "custom", config: rec.config, summary: rec.summary };
    }
    yield { event: "done" };
  } finally {
    clearTimeout(deadlineTimer);
    input.signal?.removeEventListener("abort", onClientAbort);
  }
}
