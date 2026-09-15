import { useState } from "react";

import { Button, Field, Modal, StarRating, Textarea, useToast } from "../ui";
import { submitReview } from "../../lib/actions";

interface ReviewDialogProps {
  open: boolean;
  onClose: () => void;
  entityId: string;
  author: string;
  onSubmitted?: () => void;
}

export function ReviewDialog({
  open,
  onClose,
  entityId,
  author,
  onSubmitted,
}: ReviewDialogProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);

  const reset = () => {
    setRating(5);
    setText("");
    setInvalid(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!text.trim()) {
      setInvalid(true);
      return;
    }
    await submitReview(entityId, author, rating, text.trim());
    toast("Спасибо! Отзыв сохранён.");
    onSubmitted?.();
    handleClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Оставить отзыв"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            Отмена
          </Button>
          <Button onClick={handleSubmit}>Отправить отзыв</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <span className="mb-2 block font-semibold">
            Ваша оценка<span className="text-destructive">*</span>
          </span>
          <StarRating value={rating} readonly={false} onChange={setRating} />
        </div>
        <Field
          label="Комментарий"
          htmlFor="review-text"
          required
          error={invalid ? "Пожалуйста, напишите текст отзыва." : undefined}
        >
          <Textarea
            id="review-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (invalid) setInvalid(false);
            }}
            placeholder="Поделитесь впечатлениями о сборке…"
          />
        </Field>
      </div>
    </Modal>
  );
}