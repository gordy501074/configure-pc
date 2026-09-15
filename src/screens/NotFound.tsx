import { Link } from "react-router-dom";

import { Button, Card } from "../components/ui";

export default function NotFound() {
  return (
    <div className="container flex flex-1 items-center justify-center">
      <Card className="w-full max-w-md items-center gap-3 py-12 text-center">
        <p className="text-6xl font-bold text-primary" aria-hidden="true">
          404
        </p>
        <h1 className="text-2xl font-bold">Страница не найдена</h1>
        <p className="text-muted-foreground">
          Возможно, ссылка устарела или адрес указан неверно.
        </p>
        <Link to="/">
          <Button>Вернуться на главную</Button>
        </Link>
      </Card>
    </div>
  );
}