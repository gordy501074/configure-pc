import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Breadcrumbs, Button, Card, useToast } from "../components/ui";
import { cn } from "../lib/utils";
import { BUDGET_PRESETS } from "../lib/survey";
import type { Ecosystem, Priority, SurveyAnswers, Usage } from "../types";

interface StepProps {
  answers: SurveyAnswers;
  setAnswers: (u: (a: SurveyAnswers) => SurveyAnswers) => void;
}

function BudgetStep({ answers, setAnswers }: StepProps) {
  const labels = ["Стартовый", "Оптимальный", "Производительный", "Профи", "Максимум"];
  return (
    <StepShell step={1}>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Бюджет">
        {BUDGET_PRESETS.map((b, i) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={answers.budget === b}
            className={cn(
              "flex items-center justify-between rounded-md border px-4 py-3 text-left transition-colors",
              answers.budget === b
                ? "border-primary bg-primary/5"
                : "border-input hover:border-ring hover:bg-accent/50",
            )}
            onClick={() => setAnswers((a) => ({ ...a, budget: b }))}
          >
            <span className="font-medium">{labels[i]}</span>
            <span className="text-sm text-muted-foreground">
              {new Intl.NumberFormat("ru-RU").format(b)} ₽
            </span>
          </button>
        ))}
      </div>
    </StepShell>
  );
}

function UsageStep({ answers, setAnswers }: StepProps) {
  const options: { value: Usage; label: string; desc: string }[] = [
    { value: "gaming", label: "Игры", desc: "Высокий FPS в современных играх" },
    { value: "work", label: "Работа / офис", desc: "Документы, браузер, офисные задачи" },
    { value: "video", label: "Видеомонтаж", desc: "Рендеринг, 3D, тяжёлый контент" },
    { value: "universal", label: "Универсальный", desc: "Всё понемногу" },
  ];
  return (
    <StepShell step={2}>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <UsageOption
            key={o.value}
            label={o.label}
            desc={o.desc}
            active={answers.usage === o.value}
            onClick={() => setAnswers((a) => ({ ...a, usage: o.value }))}
          />
        ))}
      </div>
    </StepShell>
  );
}

function EcosystemStep({ answers, setAnswers }: StepProps) {
  const options: { value: Ecosystem; label: string }[] = [
    { value: "intel", label: "Intel" },
    { value: "amd", label: "AMD" },
  ];
  return (
    <StepShell step={3}>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={answers.ecosystem === o.value}
            className={cn(
              "rounded-md border px-4 py-5 text-center font-medium transition-colors",
              answers.ecosystem === o.value
                ? "border-primary bg-primary/5"
                : "border-input hover:border-ring hover:bg-accent/50",
            )}
            onClick={() => setAnswers((a) => ({ ...a, ecosystem: o.value }))}
          >
            {o.label}
          </button>
        ))}
      </div>
    </StepShell>
  );
}

function PriorityStep({ answers, setAnswers }: StepProps) {
  const options: { value: Priority; label: string; desc: string }[] = [
    { value: "perf", label: "Максимум производительности", desc: "Лучшее железо в рамках бюджета" },
    { value: "price", label: "Лучшее за деньги", desc: "Оптимальные цена и характеристики" },
    { value: "silent", label: "Тишина", desc: "Тихое охлаждение и работа" },
  ];
  return (
    <StepShell step={4}>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <UsageOption
            key={o.value}
            label={o.label}
            desc={o.desc}
            active={answers.priority === o.value}
            onClick={() => setAnswers((a) => ({ ...a, priority: o.value }))}
          />
        ))}
      </div>
    </StepShell>
  );
}

function StepShell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Шаг {step} из 4</p>
      {children}
    </div>
  );
}

function UsageOption({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={cn(
        "flex flex-col gap-1 rounded-md border px-4 py-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-input hover:border-ring hover:bg-accent/50",
      )}
      onClick={onClick}
    >
      <span className="font-medium">{label}</span>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </button>
  );
}

const STEPS = [BudgetStep, UsageStep, EcosystemStep, PriorityStep];

export default function AutoSelect() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({
    budget: 120000,
    usage: "gaming",
    ecosystem: "amd",
    priority: "perf",
  });

  const StepComponent = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }
    navigate("/auto/result", { state: { answers } });
    toast("Подбираем конфигурацию…", "info");
  };

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Автоподбор" }]} />
      <h1 className="text-3xl font-bold">Автоподбор ПК</h1>
      <p className="mb-5 mt-1 text-muted-foreground">
        Ответьте на вопросы — подберём сборку под ваши задачи и бюджет.
      </p>

      <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          className="block h-full rounded-full bg-primary transition-all"
          style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      <Card className="p-6">
        <form onSubmit={onSubmit} noValidate>
          <StepComponent answers={answers} setAnswers={setAnswers} />
          <div className="mt-6 flex items-center justify-between">
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Назад
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="lg">
              {isLast ? "Подобрать" : "Далее"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}