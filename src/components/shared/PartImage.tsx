import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "../ui";

/**
 * Fixed 64x64 (size-16) component thumbnail so card height never changes with or
 * without a photo. Falls back to a same-size placeholder icon when the image is
 * missing or fails to load. Double-clicking a real photo opens the full-size
 * image in a modal; pass `zoomable={false}` where a double-click must not open
 * it (e.g. inside a row that is itself a button).
 */
export function PartImage({
  image,
  alt,
  className,
  zoomable = true,
}: {
  image?: string;
  alt: string;
  className?: string;
  zoomable?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setFailed(false);
    setOpen(false);
  }, [image]);

  const hasImage = !!image && !failed;
  const canZoom = zoomable && hasImage;

  return (
    <>
      <div
        className={cn(
          "size-16 shrink-0 overflow-hidden rounded-md border bg-muted",
          canZoom && "cursor-zoom-in",
          className,
        )}
        onDoubleClick={() => {
          if (canZoom) setOpen(true);
        }}
        title={canZoom ? "Двойной клик — открыть фото" : undefined}
      >
        {hasImage ? (
          <img
            src={image}
            alt={alt}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-muted-foreground"
            role="img"
            aria-label={alt}
          >
            <ImageOff className="size-6" aria-hidden="true" />
          </div>
        )}
      </div>

      {canZoom ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle className="sr-only">{alt}</DialogTitle>
            <img
              src={image}
              alt={alt}
              className="mx-auto max-h-[80vh] w-full rounded-md object-contain"
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}