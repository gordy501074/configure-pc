import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import {
  Breadcrumbs,
  Button,
  Card,
  useToast,
} from "../components/ui";
import { ConfigPartsTable } from "../components/shared/ConfigPartsTable";
import { InstallmentPlan } from "../components/shared/InstallmentPlan";
import { advisorErrorMessage, streamAdvisorChat } from "../lib/api";
import { configStats } from "../lib/compatibility";
import { formatPrice } from "../lib/format";
import { useAuth } from "../lib/auth";
import { useSeller } from "../lib/useSeller";
import { saveConfigAction, shareAction } from "../lib/actions";
import { uid } from "../lib/session";
import { cn } from "../lib/utils";
import type {
  AdvisorMessage,
  AdvisorRequirements,
  Config,
} from "../types";

interface Recommendation {
  kind: "ready" | "custom";
  readyPcId?: string;
  config?: Config;
  summary: string;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const WELCOME =
  "Привет! Помогу подобрать компьютер. Расскажите: какой у вас бюджет?";

export default function AutoChat() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isCustomer } = useAuth();
  const { sellerId } = useSeller();

  const [entries, setEntries] = useState<ChatEntry[]>([
    { id: "welcome", role: "assistant", text: WELCOME },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Clean transcript of real turns only (no error text / placeholders), used as
  // the LLM context for the next request.
  const historyRef = useRef<AdvisorMessage[]>([]);
  // Requirements gathered so far (server-merged), sent back on every turn so
  // the budget/use-case survive even when the model forgets them.
  const requirementsRef = useRef<AdvisorRequirements>({});
  // Buffered streaming tail, flushed to `entries` on an animation frame so a
  // burst of deltas causes one render, not one per token.
  const pendingRef = useRef("");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [entries, busy]);

  // Return the caret to the input after every finished reply (the send button
  // must not keep focus). Not on mount: that would pull focus off the tab list.
  const wasBusyRef = useRef(false);
  useEffect(() => {
    if (wasBusyRef.current && !busy) inputRef.current?.focus();
    wasBusyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const flushPending = (id: string) => {
    const text = pendingRef.current;
    if (!text) return;
    pendingRef.current = "";
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, text: e.text + text } : e)));
  };

  const appendToChunk = (id: string, text: string) => {
    pendingRef.current += text;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushPending(id);
    });
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;

    // LLM context: the clean transcript so far, then the new user message.
    const history: AdvisorMessage[] = [
      ...historyRef.current,
      { role: "user", content: text },
    ];

    historyRef.current = history;
    setEntries((list) => [...list, { id: uid("chat"), role: "user", text }]);
    setInput("");
    setBusy(true);
    controllerRef.current = new AbortController();
    const assistantId = uid("chat");
    setEntries((list) => [...list, { id: assistantId, role: "assistant", text: "" }]);

    let errorCode: string | null = null;
    let reco: Recommendation | null = null;
    let assistantText = "";
    try {
      await streamAdvisorChat(
        { messages: history, sellerId, requirements: requirementsRef.current },
        {
          signal: controllerRef.current.signal,
          onEvent: (ev) => {
            if (ev.event === "delta") {
              assistantText += ev.text;
              appendToChunk(assistantId, ev.text);
            } else if (ev.event === "requirements") {
              requirementsRef.current = ev.data;
            } else if (ev.event === "recommendation") {
              reco =
                ev.kind === "ready"
                  ? { kind: "ready", readyPcId: ev.readyPcId, summary: ev.summary }
                  : { kind: "custom", config: ev.config, summary: ev.summary };
            }
          },
        },
      );
    } catch (err) {
      errorCode = err instanceof Error ? err.message : "ai_failed";
      if (errorCode === "AbortError" || controllerRef.current?.signal.aborted) {
        // Disconnected: don't append an error bubble.
        errorCode = null;
      }
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    flushPending(assistantId);

    // Record only genuine assistant text in the transcript (never the error
    // suffix or the `…` placeholder below).
    if (assistantText.trim()) {
      historyRef.current = [...historyRef.current, { role: "assistant", content: assistantText }];
    }

    if (errorCode) {
      setEntries((list) =>
        list.map((e) =>
          e.id === assistantId
            ? { ...e, text: `${e.text}\n\n${advisorErrorMessage(errorCode)}`.trim() }
            : e,
        ),
      );
    } else if (!assistantText.trim()) {
      // No visible text and no error: keep the bubble from being blank.
      setEntries((list) =>
        list.map((e) => (e.id === assistantId && e.text.trim() === "" ? { ...e, text: "…" } : e)),
      );
    }
    if (reco) {
      setRecommendation(reco);
      toast("Подбор готов!", "success");
    }
    setBusy(false);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const openRecommendation = () => {
    if (!recommendation) return;
    if (recommendation.kind === "ready" && recommendation.readyPcId) {
      navigate(`/ready/${encodeURIComponent(recommendation.readyPcId)}`);
    } else if (recommendation.kind === "custom" && recommendation.config) {
      navigate("/auto/result", { state: { config: recommendation.config } });
    }
  };

  const handleSave = async () => {
    if (!recommendation?.config) return;
    if (!user) {
      toast("Войдите, чтобы сохранить конфигурацию", "info");
      navigate("/auth");
      return;
    }
    const cfg: Config = {
      ...recommendation.config,
      id: uid("cfg"),
      updatedAt: Date.now(),
      sellerId,
    };
    const res = await saveConfigAction(cfg, user.id);
    toast(res.message);
  };

  const handleShare = async () => {
    if (!recommendation) return;
    const res = await shareAction(recommendation.summary, window.location.href);
    toast(res.message, res.ok ? "success" : "error");
  };

  const stats = recommendation?.config
    ? configStats({ parts: recommendation.config.parts })
    : null;

  return (
    <div className="container">
      <Breadcrumbs
        items={[
          { label: "Главная", to: "/" },
          { label: "Автоподбор", to: "/auto" },
          { label: "Подбор с помощью AI-бота" },
        ]}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold">Подбор с помощью AI-бота</h1>
          <p className="text-muted-foreground">
            Расскажите о задачах и бюджете — бот уточнит детали и предложит сборку
            из реального каталога с актуальными ценами.
          </p>
        </header>

        <Card className="gap-0 p-0">
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Переписка с AI-помощником"
            className="flex max-h-[60vh] min-h-[320px] flex-col gap-3 overflow-y-auto p-4"
          >
            {entries.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "flex flex-col gap-1",
                  entry.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm leading-relaxed",
                    entry.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {entry.text}
                  {busy && entries[entries.length - 1]?.id === entry.id ? (
                    <span aria-hidden="true" className="animate-pulse">
                      {" "}
                      …
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            {busy ? (
              <div className="px-1 text-xs text-muted-foreground" aria-hidden="true">
                Печатает…
              </div>
            ) : null}
          </div>

          {recommendation ? (
            <Card className="mx-3 mb-3 gap-3 border-primary/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Рекомендация готова</h2>
                {stats ? (
                  <span className="text-sm font-semibold">{formatPrice(stats.totalPrice)}</span>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">{recommendation.summary}</p>
              {recommendation.config ? (
                <>
                  <ConfigPartsTable parts={recommendation.config.parts} />
                  {isCustomer ? (
                    <div className="max-w-sm">
                      <InstallmentPlan
                        total={stats?.totalPrice ?? 0}
                        state={{ config: { ...recommendation.config, sellerId } }}
                      />
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button onClick={openRecommendation}>
                  {recommendation.kind === "ready" ? "Открыть сборку" : "Открыть / оформить"}
                </Button>
                {recommendation.kind === "custom" && isCustomer ? (
                  <Button variant="ghost" onClick={handleSave}>
                    Сохранить
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={handleShare}>
                  Поделиться
                </Button>
              </div>
            </Card>
          ) : null}

          <form
            onSubmit={onSubmit}
            className="flex items-end gap-2 border-t p-3"
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={2000}
              aria-busy={busy}
              aria-label="Сообщение для AI-помощника"
              placeholder="Например: бюджет 150 000 ₽ на игры…"
              className="min-h-12 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-60"
            />
            <Button type="submit" disabled={busy || !input.trim()}>
              Отправить
            </Button>
          </form>
        </Card>

        <p className="text-xs text-muted-foreground">
          Enter — отправить, Shift+Enter — перенос строки. Подбор использует только
          реальные компоненты и цены выбранного прайс-листа.
        </p>
      </div>
    </div>
  );
}