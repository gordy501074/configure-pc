import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "../components/ui";
import {
  createUser,
  deleteUpload,
  deleteUser,
  fetchFakeDoorCtr,
  fetchUploads,
  fetchUsers,
  pruneUploads,
  setUserRole,
  type UploadEntry,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDate } from "../lib/format";
import { cn } from "../lib/utils";
import { useSort } from "../lib/useSort";
import { SortableTh } from "../components/ui/SortableTh";
import { PartImage } from "../components/shared/PartImage";
import type { AnalyticsPeriod, FakeDoorCtrRow, User, UserRole } from "../types";

const ROLE_LABELS: Record<UserRole, string> = {
  customer: "Клиент",
  seller: "Продавец",
  admin: "Администратор",
};

const CTR_PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: "7d", label: "7 дней" },
  { key: "30d", label: "30 дней" },
  { key: "90d", label: "90 дней" },
  { key: "all", label: "Весь период" },
];

function contactLabel(u: User): string {
  if (u.role === "customer") return [u.email, u.phone].filter(Boolean).join(" · ") || "—";
  return u.email ?? "—";
}

/** Human-readable file size (KB/MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

interface CreateForm {
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  company: string;
}

const emptyForm: CreateForm = { name: "", email: "", phone: "", role: "customer", company: "" };

export default function Admin({ embedded = false }: { embedded?: boolean }) {
  const { user, isAdmin, refreshUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(emptyForm);
  const [creating, setCreating] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [uploadsLoading, setUploadsLoading] = useState(true);
  const [pruneOpen, setPruneOpen] = useState(false);
  const [pruneBusy, setPruneBusy] = useState(false);
  const { sort, toggle, sorted } = useSort();

  const [ctrPeriod, setCtrPeriod] = useState<AnalyticsPeriod>("30d");
  const [ctrRows, setCtrRows] = useState<FakeDoorCtrRow[]>([]);
  const [ctrLoading, setCtrLoading] = useState(true);
  const [ctrError, setCtrError] = useState(false);
  const ctrSort = useSort();

  const sortedUsers = useMemo(
    () =>
      sorted(users, (u: User) => {
        switch (sort?.key) {
          case "name": return u.name;
          case "role": return ROLE_LABELS[u.role];
          case "contact": return contactLabel(u);
          case "company": return u.company ?? "";
          case "createdAt": return u.createdAt;
          default: return u.name;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, sort],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await fetchUsers());
    } catch {
      toast("Не удалось загрузить пользователей", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      setUploads(await fetchUploads());
    } catch {
      toast("Не удалось загрузить фото", "error");
    } finally {
      setUploadsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadUploads();
  }, [loadUploads]);

  const loadCtr = useCallback(async () => {
    setCtrLoading(true);
    setCtrError(false);
    try {
      setCtrRows(await fetchFakeDoorCtr(ctrPeriod));
    } catch {
      setCtrError(true);
      setCtrRows([]);
    } finally {
      setCtrLoading(false);
    }
  }, [ctrPeriod]);

  useEffect(() => {
    void loadCtr();
  }, [loadCtr]);

  const sortedCtr = useMemo(
    () =>
      ctrSort.sorted(ctrRows, (r: FakeDoorCtrRow) => {
        switch (ctrSort.sort?.key) {
          case "views": return r.views;
          case "clicks": return r.clicks;
          case "impressions": return r.impressions;
          case "ctr": return r.ctr ?? -1;
          default: return r.label;
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctrRows, ctrSort.sort],
  );

  if (!isAdmin) {
    return (
      <div className="container">
        <p className="text-muted-foreground">Доступ только для администратора.</p>
        <Button variant="secondary" onClick={() => navigate("/")}>
          На главную
        </Button>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast("Укажите имя", "error");
      return;
    }
    setCreating(true);
    try {
      await createUser({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone:
          form.role === "customer" && form.phone.trim() ? form.phone.trim() : undefined,
        role: form.role,
        company: form.role === "seller" ? form.company.trim() || undefined : undefined,
      });
      toast("Пользователь создан");
      setShowCreate(false);
      setForm(emptyForm);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(
        message === "email_exists"
          ? "Пользователь с таким e-mail уже существует"
          : "Не удалось создать пользователя",
        "error",
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (u: User) => {
    if (u.id === user?.id) {
      toast("Нельзя удалить собственный аккаунт", "warning");
      return;
    }
    try {
      await deleteUser(u.id);
      toast("Пользователь удалён", "info");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(message || "Не удалось удалить пользователя", "error");
    }
  };

  const handleRoleChange = async (u: User, role: UserRole) => {
    if (role === u.role) return;
    try {
      await setUserRole(u.id, role);
      toast(`Роль изменена на «${ROLE_LABELS[role]}»`);
      await load();
      if (u.id === user?.id) await refreshUser();
    } catch {
      toast("Не удалось изменить роль", "error");
    }
  };

  const handleDeleteUpload = async (entry: UploadEntry) => {
    try {
      await deleteUpload(entry.file);
      toast("Файл удалён", "info");
      await loadUploads();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(
        message === "file_in_use"
          ? "Файл используется компонентом"
          : "Не удалось удалить файл",
        "error",
      );
    }
  };

  const handlePrune = async () => {
    setPruneBusy(true);
    try {
      const { deleted } = await pruneUploads();
      toast(`Удалено файлов: ${deleted}`);
      setPruneOpen(false);
      await loadUploads();
    } catch {
      toast("Не удалось удалить неиспользуемые файлы", "error");
    } finally {
      setPruneBusy(false);
    }
  };

  return (
    <div className={embedded ? "" : "container"}>
      {!embedded ? (
        <Breadcrumbs items={[{ label: "Главная", to: "/" }, { label: "Администрирование" }]} />
      ) : null}

      <section className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Администрирование</h1>
          <p className="text-sm text-muted-foreground">
            Управление пользователями: создание, удаление, назначение ролей.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>Добавить пользователя</Button>
      </section>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Загрузка пользователей…</div>
        ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTh label="Имя" column="name" sort={sort} onSort={toggle} />
              <SortableTh label="Роль" column="role" sort={sort} onSort={toggle} />
              <SortableTh label="Контакт" column="contact" sort={sort} onSort={toggle} />
              <SortableTh label="Компания" column="company" sort={sort} onSort={toggle} />
              <SortableTh label="Создан" column="createdAt" sort={sort} onSort={toggle} />
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedUsers.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => handleRoleChange(u, v as UserRole)}>
                    <SelectTrigger size="sm" aria-label={`Роль: ${u.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>{contactLabel(u)}</TableCell>
                <TableCell>
                  {u.role === "seller" ? (
                    <Badge variant="neutral">{u.company ?? "—"}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={u.id === user?.id}
                    onClick={() => handleDelete(u)}
                  >
                    Удалить
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        )}
      </Card>

      <section className="mt-8" aria-label="CTR по fake door">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">CTR по fake door</h2>
            <p className="text-sm text-muted-foreground">
              Просмотры экрана-носителя, клики по заглушкам и показы схем рассрочки (A/B).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Период CTR">
              {CTR_PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={ctrPeriod === p.key}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    ctrPeriod === p.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setCtrPeriod(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => loadCtr()}>
              Обновить
            </Button>
          </div>
        </div>

        {ctrLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Загрузка CTR…</div>
        ) : ctrError || ctrRows.length === 0 ? (
          <EmptyState
            title="Нет данных о fake door"
            description="CTR появится здесь после кликов и просмотров на экранах-носителях."
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh label="Fake door" column="label" sort={ctrSort.sort} onSort={ctrSort.toggle} />
                  <SortableTh label="Просмотры" column="views" sort={ctrSort.sort} onSort={ctrSort.toggle} align="right" />
                  <SortableTh label="Клики" column="clicks" sort={ctrSort.sort} onSort={ctrSort.toggle} align="right" />
                  <SortableTh label="CTR%" column="ctr" sort={ctrSort.sort} onSort={ctrSort.toggle} align="right" />
                  <SortableTh label="Показы (A/B)" column="impressions" sort={ctrSort.sort} onSort={ctrSort.toggle} align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCtr.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.views}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.clicks}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.ctr === null || r.views === 0 ? "—" : `${Math.round(r.ctr * 100)}%`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.impressions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <section className="mt-8" aria-label="Загруженные фото">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Загруженные фото</h2>
            <p className="text-sm text-muted-foreground">
              Фото компонентов. Неиспользуемые файлы можно удалить.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => loadUploads()}>
              Обновить
            </Button>
            <Button variant="destructive" onClick={() => setPruneOpen(true)}>
              Удалить неиспользуемые
            </Button>
          </div>
        </div>

        {uploadsLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Загрузка фото…</div>
        ) : uploads.length === 0 ? (
          <EmptyState
            title="Загруженных фото нет"
            description="Фото появятся здесь после загрузки в карточке компонента."
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Фото</TableHead>
                  <TableHead>Файл</TableHead>
                  <TableHead>Размер</TableHead>
                  <TableHead>Загружен</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uploads.map((u) => (
                  <TableRow key={u.file}>
                    <TableCell>
                      <PartImage image={u.url} alt={u.partName ?? u.file} />
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate font-medium">{u.file}</TableCell>
                    <TableCell className="text-muted-foreground">{formatBytes(u.size)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(u.modifiedAt)}</TableCell>
                    <TableCell>
                      {u.used ? (
                        <Badge variant="success" title={u.partName}>
                          Используется{u.partName ? `: ${u.partName}` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Не используется</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={u.used}
                        title={u.used ? "Файл используется компонентом" : undefined}
                        onClick={() => handleDeleteUpload(u)}
                      >
                        Удалить
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </section>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Новый пользователь"
        description="Клиенту разрешён e-mail и/или телефон; продавцу и администратору — только e-mail."
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={creating}>
              Отмена
            </Button>
            <Button loading={creating} onClick={handleCreate}>
              Создать
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Имя" htmlFor="admin-name" required>
            <Input
              id="admin-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Роль" htmlFor="admin-role">
            <Select
              value={form.role}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, role: v as UserRole }))
              }
            >
              <SelectTrigger id="admin-role" className="w-full">
                <SelectValue placeholder="Роль" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="E-mail" htmlFor="admin-email">
            <Input
              id="admin-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
          {form.role === "seller" ? (
            <Field label="Компания" htmlFor="admin-company" hint="Для продавца.">
              <Input
                id="admin-company"
                value={form.company}
                onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
              />
            </Field>
          ) : null}
          {form.role === "customer" ? (
            <Field label="Телефон" htmlFor="admin-phone" hint="Для клиента.">
              <Input
                id="admin-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={pruneOpen}
        onClose={() => setPruneOpen(false)}
        title="Удалить неиспользуемые фото"
        description="Все загруженные файлы, не привязанные ни к одному компоненту, будут удалены безвозвратно."
        footer={
          <>
            <Button variant="ghost" onClick={() => setPruneOpen(false)} disabled={pruneBusy}>
              Отмена
            </Button>
            <Button variant="destructive" loading={pruneBusy} onClick={handlePrune}>
              Удалить
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Используемые компонентами файлы не затрагиваются.
        </p>
      </Modal>
    </div>
  );
}