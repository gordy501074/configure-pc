import type { Config, Review } from "../types";
import { uid } from "./session";
import {
  deleteConfigRemote,
  fetchReviews,
  saveConfigRemote,
  submitReviewRemote,
} from "./api";
export interface SharedResult {
  ok: boolean;
  message: string;
}

/** Save (or update) a config in the user's profile stored in the database. */
export async function saveConfigAction(config: Config, userId: string): Promise<SharedResult> {
  await saveConfigRemote(config, userId);
  return {
    ok: true,
    message: `Сохранено в профиль: «${config.name}»`,
  };
}

/** Delete a config from the database by id. */
export async function removeConfigAction(id: string): Promise<SharedResult> {
  await deleteConfigRemote(id);
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

/** Submit a review for an entity to the database. */
export async function submitReview(
  entityId: string,
  author: string,
  rating: number,
  text: string,
): Promise<Review[]> {
  const review: Review = {
    id: uid("rev"),
    entityId,
    author,
    rating,
    text,
    createdAt: Date.now(),
  };
  await submitReviewRemote(entityId, author, rating, text, review.id);
  return listReviews(entityId);
}

/** Fetch existing reviews for an entity (seeded + user) from the database. */
export async function listReviews(entityId: string): Promise<Review[]> {
  return fetchReviews(entityId);
}