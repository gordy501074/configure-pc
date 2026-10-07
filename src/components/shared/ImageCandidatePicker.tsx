import { useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { Button, Dialog, DialogContent, DialogTitle, Modal, Skeleton } from "../ui";
import { cn } from "@/lib/utils";
import { PartImage } from "./PartImage";
import type { ImageStreamEvent } from "../../lib/api";

export type ImagePickerStatus = "searching" | "done" | "error";

export interface ImageCandidate {
  url: string;
  index: number;
}

interface ImageCandidatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
  onStop: () => void;
  status: ImagePickerStatus;
  phase: ImageStreamEvent | null;
  /** Total search budget in ms; drives the local countdown. */
  deadlineMs: number;
  candidates: ImageCandidate[];
  error: string | null;
}

const PHASE_LABELS: Record<string, string> = {
  search_pages: "Ищу страницы товара…",
  download: "Загружаю изображения…",
};

export function ImageCandidatePicker({
  open,
  onClose,
  onSelect,
  onStop,
  status,
  phase,
  deadlineMs,
  candidates,
  error,
}: ImageCandidatePickerProps) {
  const [remaining, setRemaining] = useState(Math.ceil(deadlineMs / 1000));
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const startedAt = useRef(0);

  // Restart the countdown each time a new search opens.
  useEffect(() => {
    if (!open) return;
    startedAt.current = Date.now();
    setRemaining(Math.ceil(deadlineMs / 1000));
    setSelectedUrl(null);
    setPreviewUrl(null);
  }, [open, deadlineMs]);

  // Drop a selection that is no longer among the candidates.
  useEffect(() => {
    setSelectedUrl((cur) =>
      cur && candidates.some((c) => c.url === cur) ? cur : null,
    );
  }, [candidates]);

  useEffect(() => {
    if (!open || status !== "searching") return;
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setRemaining(Math.max(0, Math.ceil((deadlineMs - elapsed * 1000) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, status, deadlineMs]);

  const phaseKey = phase?.event === "phase" ? phase.phase : null;
  const pageCount =
    phase?.event === "phase" && phase.phase === "download" ? phase.pages : undefined;

  const searching = status === "searching";

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        className="sm:max-w-xl"
        title="Выбор фото (AI)"
        description={
          searching
            ? "Поиск фотографии в интернете"
            : "Одинарный клик — выбрать, двойной клик — посмотреть полностью"
        }
        footer={
          searching ? (
            <Button variant="secondary" onClick={onStop}>
              Стоп
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Закрыть
              </Button>
              <Button
                disabled={!selectedUrl}
                onClick={() => selectedUrl && onSelect(selectedUrl)}
              >
                Выбрать
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {searching || candidates.length === 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {searching && candidates.length === 0 ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="size-4" aria-hidden="true" />
                )}
                <span>
                  {status === "error"
                    ? error === "ai_not_configured"
                      ? "AI не настроен"
                      : "AI не смог выполнить запрос"
                    : phaseKey
                      ? PHASE_LABELS[phaseKey] ?? "Поиск…"
                      : "Поиск фотографии…"}
                  {pageCount !== undefined && status === "searching"
                    ? ` (${pageCount} стр.)`
                    : ""}
                </span>
              </div>

              {searching ? (
                <p className="text-sm text-muted-foreground" role="status">
                  Осталось ~{remaining} с
                </p>
              ) : null}

              {candidates.length === 0 && status === "done" ? (
                <p className="text-sm text-muted-foreground">Ничего не найдено.</p>
              ) : null}
            </div>
          ) : null}

          {candidates.length > 0 ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {candidates.map((c) => {
                const selected = selectedUrl === c.url;
                return (
                  <div
                    key={c.url}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Кандидат ${c.index}`}
                    onClick={() => setSelectedUrl(c.url)}
                    onDoubleClick={() => setPreviewUrl(c.url)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedUrl(c.url);
                      }
                    }}
                    className={cn(
                      "group relative flex cursor-pointer flex-col items-center gap-1 rounded-md border p-2 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      selected
                        ? "border-ring bg-accent/60 ring-[3px] ring-ring/50"
                        : "border-input hover:border-ring hover:bg-accent/50",
                    )}
                    title="Одинарный клик — выбрать, двойной клик — посмотреть полностью"
                  >
                    <PartImage image={c.url} alt={`Кандидат ${c.index}`} zoomable={false} />
                    <span className="text-xs text-muted-foreground">#{c.index}</span>
                  </div>
                );
              })}
              {searching && candidates.length < 5 ? (
                <Skeleton className="size-16 self-center" />
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>

      <Dialog open={previewUrl !== null} onOpenChange={(o) => !o && setPreviewUrl(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle className="sr-only">Просмотр кандидата</DialogTitle>
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Просмотр кандидата"
              className="mx-auto max-h-[80vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}