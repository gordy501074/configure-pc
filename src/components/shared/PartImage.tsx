import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Fixed 64x64 (size-16) component thumbnail so card height never changes with or
 * without a photo. Falls back to a same-size placeholder icon when the image is
 * missing or fails to load.
 */
export function PartImage({
  image,
  alt,
  className,
}: {
  image?: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [image]);

  return (
    <div
      className={cn(
        "size-16 shrink-0 overflow-hidden rounded-md border bg-muted",
        className,
      )}
    >
      {image && !failed ? (
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
  );
}