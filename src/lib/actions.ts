import type { Config, Review } from "../types";
import {
  addReview,
  deleteConfig,
  getReviews,
  saveConfig,
  uid,
} from "./storage";

export interface SharedResult {
  ok: boolean;
  message: string;
}

/** Save (or update) a config in user profile storage. */
export function saveConfigAction(config: Config): SharedResult {
  saveConfig(config);
  return {
    ok: true,
    message: `Сохранено в профиль: «${config.name}»`,
  };
}

/** Delete a config from storage by id. */
export function removeConfigAction(id: string): SharedResult {
  deleteConfig(id);
  return { ok: true, message: "Конфигурация удалена" };
}

/** Copy a shareable summary to the clipboard, returning a result. */
export async function shareAction(title: string, url: string): Promise<SharedResult> {
  const text = `${title}\n${url}`;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return { ok: true, message: "Ссылка скопирована в буфер обмена" };
    }
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return { ok: true, message: "Ссылка скопирована в буфер обмена" };
  } catch {
    return { ok: false, message: "Не удалось скопировать ссылку" };
  }
}

/** Submit a review for an entity. */
export function submitReview(
  entityId: string,
  author: string,
  rating: number,
  text: string,
): Review[] {
  const review: Review = {
    id: uid("rev"),
    entityId,
    author,
    rating,
    text,
    createdAt: Date.now(),
  };
  return addReview(review);
}

/** Aggregate existing reviews for an entity, defaulting to seeded data handled by screens. */
export function listReviews(entityId: string): Review[] {
  return getReviews().filter((r) => r.entityId === entityId);
}