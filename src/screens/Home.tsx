import { Link } from "react-router-dom";

import { Badge, Button, Card } from "../components/ui";

const SECTIONS = [
  {
    to: "/ready",
    title: "Готовые ПК",
    desc: "Подборки под задачи — игры, работа, монтаж. Все собрано и проверено.",
    icon: "🖥️",
  },
  {
    to: "/config",
    title: "Собрать самому",
    desc: "Полный конфигуратор с живой проверкой совместимости каждого компонента.",
    icon: "🧩",
  },
  {
    to: "/auto",
    title: "Автоподбор",
    desc: "Ответьте на 4 вопроса — соберем оптимальную сборку под ваш бюджет.",
    icon: "⚡",
  },
];

const FEATURED = [
  {
    title: "Живая совместимость",
    desc: "Сокет, тип памяти, питание и габариты проверяются мгновенно.",
  },
  {
    title: "Хранение сборок",
    desc: "Сохраняйте, загружайте и делитесь конфигурациями из профиля.",
  },
  {
    title: "Оформление за минуту",
    desc: "Понятное оформление с детализацией состава и доставкой.",
  },
];

export default function Home() {
  return (
    <div className="container">
      <section className="flex flex-col items-center gap-4 py-8 text-center md:py-12">
        <h1 className="max-w-[18ch] text-3xl font-bold leading-tight md:text-5xl">
          Соберите компьютер, который решает ваши задачи
        </h1>
        <p className="max-w-[52ch] text-lg text-muted-foreground">
          Готовые сборки, точный конфигуратор и умный автоподбор под любой
          бюджет.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/auto">
            <Button size="lg">Подобрать за 1 минуту</Button>
          </Link>
          <Link to="/ready">
            <Button size="lg" variant="outline">
              Смотреть готовые ПК
            </Button>
          </Link>
        </div>
      </section>

      <section aria-labelledby="sections-title" className="py-6">
        <h2 id="sections-title" className="sr-only">
          Основные разделы
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {SECTIONS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="block h-full no-underline"
              aria-label={`${s.title}: ${s.desc}`}
            >
              <Card className="h-full gap-3 p-6 transition-shadow hover:shadow-md">
                <span className="text-3xl" aria-hidden="true">
                  {s.icon}
                </span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="text-muted-foreground">{s.desc}</p>
                <span className="mt-auto font-semibold text-primary">
                  Перейти →
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="features-title" className="py-6 pb-10">
        <h2 id="features-title" className="mb-5 text-2xl font-bold">
          Почему Сконфигурируй'КА
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURED.map((f) => (
            <div key={f.title} className="flex flex-col gap-3">
              <Badge variant="info">{f.title}</Badge>
              <p className="text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}