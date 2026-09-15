import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Card } from "../components/ui";
import { cn } from "../lib/utils";
import { setOnboarded as saveOnboarded } from "../lib/api";

const SLIDES = [
  {
    title: "Добро пожаловать в Сконфигурируй'КА",
    text: "Инструмент, который помогает подобрать компьютер под любые задачи — от офиса до монтажа видео.",
    emoji: "🚀",
  },
  {
    title: "Три способа собрать ПК",
    text: "Готовые проверенные сборки, точный конфигуратор с живой совместимостью или автоподбор по опроснику.",
    emoji: "🧩",
  },
  {
    title: "Сохраняйте и делитесь",
    text: "Храните свои конфигурации в профиле, загружайте их и оформляйте заказ в несколько кликов.",
    emoji: "💾",
  },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const slide = SLIDES[step];
  const last = step === SLIDES.length - 1;

  const finish = async () => {
    await saveOnboarded(true);
    navigate("/");
  };

  const handleNext = () => (last ? void finish() : setStep((s) => s + 1));
  const handleSkip = () => void finish();

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md items-center gap-4 p-8 text-center">
        <div className="text-5xl" aria-hidden="true">
          {slide.emoji}
        </div>
        <h1 className="text-2xl font-bold leading-snug">{slide.title}</h1>
        <p className="text-muted-foreground">{slide.text}</p>

        <div className="flex gap-2" aria-hidden="true">
          {SLIDES.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-2 w-2 rounded-full",
                i === step ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>

        <div className="flex w-full items-center justify-between">
          {!last ? (
            <Button variant="ghost" onClick={handleSkip}>
              Пропустить
            </Button>
          ) : (
            <span />
          )}
          <Button size="lg" onClick={handleNext}>
            {last ? "Начать" : "Далее"}
          </Button>
        </div>
      </Card>
    </div>
  );
}