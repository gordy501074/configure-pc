import { Button, Modal } from "../ui";

export interface ComingSoonDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
}

/** Reusable "Скоро" placeholder modal shared by both fake doors. */
export function ComingSoonDialog({ open, onClose, title, description }: ComingSoonDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <Button onClick={onClose}>Понятно</Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Мы уже работаем над этой функцией — она появится в ближайшее время.
      </p>
    </Modal>
  );
}