import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Card, Field, Input, useToast } from "../components/ui";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/auth";
import { requestCode, verifyCode as verifySmsCode } from "../lib/api";
import { formatPhone, parseRuPhone } from "../lib/format";

const RESEND_CD_MS = 30 * 1000;
const CODE_LENGTH = 4;

type Method = "phone" | "email";
type Step = "input" | "sms";

export default function Auth() {
  const { signIn, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [method, setMethod] = useState<Method>("email");
  const [step, setStep] = useState<Step>("input");

  const [phone, setPhone] = useState("");
  const [codeInputs, setCodeInputs] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [sentPhone, setSentPhone] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const resendTimer = useRef<number | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [errors, setErrors] = useState<{ phone?: string; code?: string; email?: string; password?: string }>({});
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    return () => {
      if (resendTimer.current) window.clearInterval(resendTimer.current);
    };
  }, []);

  const padCode = (code: string): string[] => {
    const digits = code.replace(/\D/g, "").slice(0, CODE_LENGTH).split("");
    return [...digits, ...Array(CODE_LENGTH - digits.length).fill("")];
  };

  const sendCode = async () => {
    const normalized = parseRuPhone(phone);
    if (!normalized) {
      setErrors((p) => ({ ...p, phone: "Укажите корректный российский номер." }));
      return;
    }
    setErrors((p) => ({ ...p, phone: undefined }));
    setSending(true);

    try {
      const code = await requestCode(normalized);
      setSentPhone(normalized);
      setCodeInputs(padCode(code));
      setDemoCode(code);
      setResendIn(Math.floor(RESEND_CD_MS / 1000));
      setStep("sms");
      toast(`Демо-SMS: код ${code}`, "info");
    } catch {
      setErrors((p) => ({ ...p, phone: "Не удалось отправить код. Попробуйте ещё раз." }));
    } finally {
      setSending(false);
    }
  };

  const handlePhoneSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendCode();
  };

  const handleResend = () => {
    if (resendIn > 0) return;
    sendCode();
  };

  useEffect(() => {
    if (step !== "sms" || resendIn <= 0) return;
    const t = window.setInterval(() => {
      setResendIn((r) => {
        if (r <= 1) {
          window.clearInterval(t);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, resendIn > 0]);

  const verifyCode = async (e: FormEvent | null, typed?: string, codeOverride?: string) => {
    if (e) e.preventDefault();
    const entered = (typed ?? codeInputs.join("")).trim();
    if (entered.length < CODE_LENGTH) {
      setErrors({ code: `Введите ${CODE_LENGTH} цифры из СМС.` });
      return;
    }
    setVerifying(true);
    try {
      const code = codeOverride ?? entered;
      await verifySmsCode(sentPhone || phone, code);
      await signIn({
        name: "Пользователь",
        phone: formatPhone(sentPhone || phone),
      });
      toast("Вы вошли в аккаунт");
      navigate("/");
    } catch {
      setErrors({ code: "Неверный или устаревший код." });
    } finally {
      setVerifying(false);
    }
  };

  const handleCodeInput = (idx: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setCodeInputs((prev) => {
      const next = [...prev];
      next[idx] = digit;
      return next;
    });
    setErrors((p) => ({ ...p, code: undefined }));
    if (digit && idx < CODE_LENGTH - 1) {
      document.getElementById(`sms-${idx + 1}`)?.focus();
    }
    if (idx === CODE_LENGTH - 1) {
      const all = codeInputs.map((c, i) => (i === idx ? digit : c)).join("");
      if (all.length === CODE_LENGTH) {
        window.setTimeout(() => verifyCode(null, all), 0);
      }
    }
  };

  const onCodeKeyDown = (idx: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !codeInputs[idx] && idx > 0) {
      document.getElementById(`sms-${idx - 1}`)?.focus();
    }
  };

  const handleBackToInput = () => {
    setStep("input");
    setErrors({});
  };

  const switchMethod = (m: Method) => {
    setMethod(m);
    setStep("input");
    setErrors({});
  };

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = "Укажите корректный e-mail.";
    }
    if (password.length < 4) {
      next.password = "Пароль должен содержать минимум 4 символа.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    setVerifying(true);
    try {
      await signIn({
        name: email.split("@")[0] || "Пользователь",
        email,
      });
      toast("Вы вошли в аккаунт");
      navigate("/");
    } catch {
      setErrors((p) => ({ ...p, email: "Не удалось войти. Попробуйте ещё раз." }));
    } finally {
      setVerifying(false);
    }
  };

  const continueWithoutAccount = async () => {
    await signOut();
    toast("Вы продолжите без аккаунта", "info");
    navigate("/");
  };

  const tabClass = (active: boolean) =>
    cn(
      "min-h-11 flex-1 rounded-md px-4 font-medium transition-colors",
      active
        ? "bg-primary/10 text-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md gap-6 p-6">
        <h1 className="text-2xl font-bold">Вход в аккаунт</h1>
        <p className="text-sm text-muted-foreground">
          Сохраняйте конфигурации и историю заказов. Вход демо-режима.
        </p>

        <div
          className="flex gap-1 rounded-md bg-muted p-1"
          role="tablist"
          aria-label="Способ входа"
        >
          <button
            type="button"
            role="tab"
            aria-selected={method === "email"}
            className={tabClass(method === "email")}
            onClick={() => switchMethod("email")}
          >
            По e-mail
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === "phone"}
            className={tabClass(method === "phone")}
            onClick={() => switchMethod("phone")}
          >
            По телефону
          </button>
        </div>

        {method === "email" ? (
          <form onSubmit={handleEmailSubmit} noValidate className="flex flex-col gap-4">
            <Field label="Электронная почта" htmlFor="auth-email" required error={errors.email}>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                invalid={!!errors.email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errors.email) setErrors((p) => ({ ...p, email: undefined }));
                }}
              />
            </Field>
            <Field label="Пароль" htmlFor="auth-password" required error={errors.password}>
              <Input
                id="auth-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                invalid={!!errors.password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errors.password) setErrors((p) => ({ ...p, password: undefined }));
                }}
              />
            </Field>
            <Button type="submit" size="lg" loading={verifying}>
              Войти
            </Button>
          </form>
        ) : step === "input" ? (
          <div className="flex flex-col gap-4">
            <form onSubmit={handlePhoneSubmit} noValidate className="flex flex-col gap-4">
              <Field
                label="Номер телефона"
                htmlFor="auth-phone"
                required
                error={errors.phone}
                hint="Например: +7 900 123-45-67"
              >
                <Input
                  id="auth-phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+7 (___) ___-__-__"
                  value={phone}
                  inputMode="tel"
                  invalid={!!errors.phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (errors.phone) setErrors((p) => ({ ...p, phone: undefined }));
                  }}
                />
              </Field>
              <Button type="submit" size="lg" loading={sending}>
                Получить код
              </Button>
            </form>

            <div className="my-1 flex items-center gap-3 text-sm text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span>или</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button variant="secondary" onClick={continueWithoutAccount}>
              Продолжить без аккаунта
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold">Подтверждение по СМС</h2>
            <p className="text-sm text-muted-foreground">
              Код отправлен на номер{" "}
              <strong className="font-semibold text-foreground">{formatPhone(sentPhone)}</strong>
            </p>

            <form onSubmit={(e) => verifyCode(e)} noValidate className="flex flex-col gap-4">
              <div className="flex justify-between gap-2" role="group" aria-label="Код из СМС">
                {codeInputs.map((d, i) => (
                  <Input
                    key={i}
                    id={`sms-${i}`}
                    className="h-11 w-11 px-0 text-center"
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    autoComplete="one-time-code"
                    value={d}
                    invalid={!!errors.code}
                    aria-label={`Цифра ${i + 1}`}
                    onChange={(e) => handleCodeInput(i, e.target.value)}
                    onKeyDown={(e) => onCodeKeyDown(i, e)}
                    onFocus={(e) => e.target.select()}
                  />
                ))}
              </div>
              {errors.code ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.code}
                </p>
              ) : null}

              {demoCode ? (
                <p className="text-sm text-muted-foreground">
                  Код для входа (демо):{" "}
                  <strong className="font-semibold text-foreground">{demoCode}</strong>
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-4 text-sm">
                <button
                  type="button"
                  className="font-medium text-muted-foreground no-underline hover:text-foreground disabled:opacity-50"
                  onClick={handleResend}
                  disabled={resendIn > 0}
                >
                  {resendIn > 0
                    ? `Запросить код повторно (${resendIn} с)`
                    : "Запросить код повторно"}
                </button>
                <button
                  type="button"
                  className="font-medium text-muted-foreground no-underline hover:text-foreground"
                  onClick={handleBackToInput}
                >
                  Сменить номер
                </button>
              </div>

              <Button type="submit" size="lg" loading={verifying}>
                Подтвердить и войти
              </Button>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}