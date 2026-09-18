import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  LayoutGrid,
  LayoutList,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  Modal,
  useToast,
} from "../components/ui";
import { CATEGORY_LABELS } from "../lib/format";
import { useSort } from "../lib/useSort";
import { SortableTh } from "../components/ui/SortableTh";
import {
  createPart,
  deactivatePart,
  fetchParts,
  fetchVendors,
  initializeCatalog,
  reactivatePart,
  updatePart,
} from "../lib/api";
import type { ComponentCategory, Part, PartCompat, Vendor } from "../types";

const CATEGORY_ORDER: ComponentCategory[] = [
  "cpu",
  "gpu",
  "motherboard",
  "ram",
  "storage",
  "case",
  "psu",
  "cooler",
];

type FieldControl = "text" | "number" | "ram" | "psu" | "ff" | "benches";

interface FieldMeta {
  key: keyof FormState;
  label: string;
  control: FieldControl;
  placeholder?: string;
  hint?: string;
}

/** Compat fields relevant to each category (rendered in the card and the form). */
const CATEGORY_FIELDS: Record<ComponentCategory, FieldMeta[]> = {
  cpu: [
    { key: "socket", label: "Сокет", control: "text", placeholder: "LGA1700 / AM5 / AM4" },
    { key: "benches", label: "Bench-баллы", control: "benches", hint: "Формат: label:score, через запятую (например, Multi:24400, Single:2810)" },
  ],
  gpu: [
    { key: "gpuLength", label: "Длина GPU, мм", control: "number" },
    { key: "benches", label: "Bench-баллы", control: "benches", hint: "Формат: label:score, через запятую (например, G3D:20000, GTX:16000)" },
  ],
  motherboard: [
    { key: "socket", label: "Сокет", control: "text", placeholder: "LGA1700 / AM5 / AM4" },
    { key: "chipset", label: "Чипсет", control: "text", placeholder: "B760 / B650…" },
    { key: "ramType", label: "Тип ОЗУ", control: "ram" },
    { key: "formFactor", label: "Форм-фактор платы", control: "ff" },
  ],
  ram: [{ key: "ramType", label: "Тип ОЗУ", control: "ram" }],
  storage: [],
  case: [
    { key: "formFactor", label: "Форм-фактор платы", control: "ff" },
    { key: "gpuLength", label: "Длина GPU, мм", control: "number" },
    { key: "cpuCoolerMaxHeight", label: "Макс. высота кулера, мм", control: "number" },
  ],
  psu: [
    { key: "psuForm", label: "Форм-фактор БП", control: "psu" },
    { key: "power", label: "Мощность БП, Вт", control: "number" },
  ],
  cooler: [
    { key: "coolTdp", label: "Cool TDP, Вт", control: "number" },
    { key: "sizeMm", label: "Размер, мм", control: "number" },
  ],
};

/** Human-readable compat summary for a category, joined for card display. */
function compatSummary(category: ComponentCategory, p: Part): string {
  const c = p.compat;
  return CATEGORY_FIELDS[category]
    .map((f) => {
      switch (f.key) {
        case "socket": return c.socket;
        case "chipset": return c.chipset;
        case "ramType": return c.ramType;
        case "psuForm": return c.psuForm ? (c.psuForm === "SFX" ? "SFX" : c.psuForm) : undefined;
        case "formFactor": return c.formFactor;
        case "power": return c.power != null ? `${c.power} Вт` : undefined;
        case "gpuLength": return c.gpuLength != null ? `${c.gpuLength} мм` : undefined;
        case "cpuCoolerMaxHeight": return c.cpuCoolerMaxHeight != null ? `${c.cpuCoolerMaxHeight} мм` : undefined;
        case "coolTdp": return c.coolTdp != null ? `${c.coolTdp} Вт` : undefined;
        case "sizeMm": return c.sizeMm != null ? `${c.sizeMm} мм` : undefined;
        case "benches": return c.benches?.length
          ? c.benches.map((b) => `${b.label}: ${b.score}`).join(" · ")
          : undefined;
        default: return undefined;
      }
    })
    .filter((v): v is string => !!v)
    .join(" · ");
}

interface FormState {
  category: ComponentCategory;
  brand: string;
  vendor: string;
  price: string;
  tdp: string;
  socket: string;
  chipset: string;
  ramType: string;
  psuForm: string;
  power: string;
  formFactor: string;
  gpuLength: string;
  cpuCoolerMaxHeight: string;
  coolTdp: string;
  sizeMm: string;
  benches: string;
  specs: string;
}

const BLANK: FormState = {
  category: "cpu",
  brand: "",
  vendor: "",
  price: "",
  tdp: "0",
  socket: "",
  chipset: "",
  ramType: "",
  psuForm: "",
  power: "",
  formFactor: "",
  gpuLength: "",
  cpuCoolerMaxHeight: "",
  coolTdp: "",
  sizeMm: "",
  benches: "",
  specs: "",
};

export function ProfileComponents({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast();
  const [parts, setParts] = useState<Part[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [view, setView] = useState<"list" | "grid">("list");
  const [form, setForm] = useState<FormState>(BLANK);
  const [editId, setEditId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [initOpen, setInitOpen] = useState(false);
  const [initBusy, setInitBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [v, p] = await Promise.all([fetchVendors(), fetchParts(undefined, showInactive)]);
      setVendors(v);
      setParts(p);
    } catch {
      toast("Не удалось загрузить справочник", "error");
    } finally {
      setLoading(false);
    }
  }, [toast, showInactive]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const grouped = useMemo(() => {
    const map = new Map<ComponentCategory, Part[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const p of parts) map.get(p.category)?.push(p);
    return map;
  }, [parts]);

  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const p of parts) {
      if (p.available) active += 1;
      else inactive += 1;
    }
    return { active, inactive };
  }, [parts]);

  // Sort each category's part list by the active column (per-group, keeping the
  // category section rows intact).
  const { sort, toggle, sorted } = useSort();
  const sortGroup = (list: Part[]): Part[] =>
    sorted(list, (p: Part) => {
      switch (sort?.key) {
        case "name": return p.name;
        case "tdp": return p.tdp;
        case "features": return compatSummary(p.category, p) || "";
        default: return p.name;
      }
    });

  const set = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const openCreate = () => {
    setEditId(null);
    setForm(BLANK);
    setModalOpen(true);
  };

  const openEdit = (p: Part) => {
    setEditId(p.id);
    const c = p.compat;
    setForm({
      category: p.category,
      brand: p.brand,
      vendor: vendors.find((v) => v.id === p.vendorId)?.name ?? "",
      price: String(p.price),
      tdp: String(p.tdp),
      socket: c.socket ?? "",
      chipset: c.chipset ?? "",
      ramType: c.ramType ?? "",
      psuForm: c.psuForm ?? "",
      power: c.power ? String(c.power) : "",
      formFactor: c.formFactor ?? "",
      gpuLength: c.gpuLength ? String(c.gpuLength) : "",
      cpuCoolerMaxHeight: c.cpuCoolerMaxHeight ? String(c.cpuCoolerMaxHeight) : "",
      coolTdp: c.coolTdp ? String(c.coolTdp) : "",
      sizeMm: c.sizeMm ? String(c.sizeMm) : "",
      benches: c.benches ? c.benches.map((b) => `${b.label}:${b.score}`).join(", ") : "",
      specs: p.specs.map((s) => `${s.label}:${s.value}`).join("\n"),
    });
    setModalOpen(true);
  };

  const parseOpt = (v: string): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && v !== "" ? n : undefined;
  };

  const buildCompat = (): PartCompat => {
    const c: PartCompat = {};
    for (const f of CATEGORY_FIELDS[form.category]) {
      switch (f.key) {
        case "socket": c.socket = form.socket.trim() || undefined; break;
        case "chipset": c.chipset = form.chipset.trim() || undefined; break;
        case "ramType": c.ramType = (form.ramType || undefined) as PartCompat["ramType"]; break;
        case "psuForm": c.psuForm = (form.psuForm || undefined) as PartCompat["psuForm"]; break;
        case "power": c.power = parseOpt(form.power); break;
        case "formFactor": c.formFactor = (form.formFactor || undefined) as PartCompat["formFactor"]; break;
        case "gpuLength": c.gpuLength = parseOpt(form.gpuLength); break;
        case "cpuCoolerMaxHeight": c.cpuCoolerMaxHeight = parseOpt(form.cpuCoolerMaxHeight); break;
        case "coolTdp": c.coolTdp = parseOpt(form.coolTdp); break;
        case "sizeMm": c.sizeMm = parseOpt(form.sizeMm); break;
        case "benches":
          c.benches = form.benches.trim()
            ? form.benches.split(",").map((b) => {
                const [label, score] = b.split(":").map((s) => s.trim());
                return { label, score: Number(score) };
              }).filter((b) => b.label && Number.isFinite(b.score))
            : undefined;
          break;
        default: break;
      }
    }
    return c;
  };

  const buildSpecs = () =>
    form.specs
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const i = l.indexOf(":");
        return i >= 0
          ? { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() }
          : { label: l, value: "" };
      });

  const handleSave = async () => {
    if (!form.brand.trim() || !form.vendor.trim() || !form.price.trim()) {
      toast("Заполните модель, вендора и цену", "error");
      return;
    }
    const payload = {
      category: form.category,
      brand: form.brand.trim(),
      vendor: form.vendor.trim(),
      price: Number(form.price),
      tdp: Number(form.tdp || 0),
      compat: buildCompat(),
      specs: buildSpecs(),
    };
    try {
      if (editId) {
        await updatePart(editId, payload);
        toast("Компонент обновлён");
      } else {
        await createPart(payload);
        toast("Компонент добавлен");
      }
      setModalOpen(false);
      await reload();
    } catch {
      toast("Не удалось сохранить компонент", "error");
    }
  };

  const handleDeactivate = async (p: Part) => {
    try {
      await deactivatePart(p.id);
      toast(`«${p.name}» деактивирован`);
      await reload();
    } catch {
      toast("Не удалось деактивировать компонент", "error");
    }
  };

  const handleReactivate = async (p: Part) => {
    try {
      await reactivatePart(p.id);
      toast(`«${p.name}» активирован`);
      await reload();
    } catch {
      toast("Не удалось активировать компонент", "error");
    }
  };

  const handleToggleInactive = (checked: boolean) => {
    setShowInactive(checked);
    setLoading(true);
  };

  const handleInitialize = async () => {
    setInitBusy(true);
    try {
      await initializeCatalog();
      toast("Справочник переинициализирован");
      setInitOpen(false);
      await reload();
    } catch {
      toast("Не удалось переинициализировать справочник", "error");
    } finally {
      setInitBusy(false);
    }
  };

  const vendorNames = useMemo(() => vendors.map((v) => v.name), [vendors]);
  const vendorMatches = useMemo(
    () => vendorNames.filter((n) => n.toLowerCase().includes(form.vendor.toLowerCase())),
    [vendorNames, form.vendor],
  );

  return (
    <section aria-label="Компоненты" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Справочник компонентов</h2>
        <div className="flex items-center gap-2">
          <Badge variant="success">Активно: {counts.active}</Badge>
          {showInactive ? (
            <Badge variant="neutral">Деактивировано: {counts.inactive}</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center rounded-md border p-0.5" role="group" aria-label="Режим отображения">
            <Button
              variant={view === "list" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              onClick={() => setView("list")}
              aria-pressed={view === "list"}
              title="Список"
            >
              <LayoutList aria-hidden="true" />
            </Button>
            <Button
              variant={view === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              onClick={() => setView("grid")}
              aria-pressed={view === "grid"}
              title="Карточки"
            >
              <LayoutGrid aria-hidden="true" />
            </Button>
          </div>
          <Label htmlFor="show-inactive" className="cursor-pointer">
            Показывать деактивированные
          </Label>
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={handleToggleInactive}
            aria-label="Показывать деактивированные"
          />
        </div>
        <div className="flex gap-2">
          {isAdmin ? (
            <Button variant="secondary" onClick={() => setInitOpen(true)}>
              Инициализировать справочник
            </Button>
          ) : null}
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            Создать компонент
          </Button>
        </div>
      </div>

      {loading ? (
        <EmptyState title="Загрузка…" description="Пожалуйста, подождите." />
      ) : parts.length === 0 ? (
        <EmptyState
          title="Компонентов пока нет"
          description="Создайте первый компонент или выполните инициализацию справочника."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {view === "grid" ? (
            CATEGORY_ORDER.map((cat) => {
              const list = grouped.get(cat) ?? [];
              if (list.length === 0) return null;
              return (
                <Card key={cat} className="gap-3 p-4">
                  <h3 className="text-base font-semibold">{CATEGORY_LABELS[cat]}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {list.map((p) => (
                      <div
                        key={p.id}
                        className={`flex flex-col gap-2 rounded-md border p-3 ${p.available ? "" : "opacity-80"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className={p.available ? "font-medium" : "font-medium text-muted-foreground line-through"}>
                            {p.name}
                          </span>
                          {!p.available ? (
                            <Badge variant="destructive">Недоступен</Badge>
                          ) : null}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {vendors.find((v) => v.id === p.vendorId)?.name ?? p.brand}
                          {p.available ? ` · ${p.tdp} Вт` : ""}
                        </span>
                        {p.available ? (
                          <span className="text-sm text-muted-foreground">
                            {compatSummary(cat, p) || "—"}
                          </span>
                        ) : null}
                        {p.available ? (
                          <div className="mt-auto flex gap-1 border-t pt-2">
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(p)} title="Редактировать" aria-label={`Редактировать ${p.name}`}>
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="icon" className="size-8" onClick={() => handleDeactivate(p)} title="Деактивировать" aria-label={`Деактивировать ${p.name}`}>
                              <Trash2 aria-hidden="true" />
                            </Button>
                          </div>
                        ) : (
                          <div className="mt-auto border-t pt-2">
                            <Button variant="secondary" size="icon" className="size-8" onClick={() => handleReactivate(p)} title="Активировать" aria-label={`Активировать ${p.name}`}>
                              <RotateCcw aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })
          ) : (
            <Card className="gap-3 p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh label="Компонент" column="name" sort={sort} onSort={toggle} />
                    <SortableTh label="Категория" column="category" sort={sort} onSort={toggle} />
                    <SortableTh label="TDP" column="tdp" sort={sort} onSort={toggle} />
                    <SortableTh label="Особенности" column="features" sort={sort} onSort={toggle} />
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {CATEGORY_ORDER.map((cat) => {
                    const list = grouped.get(cat) ?? [];
                    if (list.length === 0) return null;
                    return (
                      <Fragment key={cat}>
                        <TableRow className="bg-muted font-medium">
                          <TableCell colSpan={5} className="font-semibold">
                            {CATEGORY_LABELS[cat]}
                          </TableCell>
                        </TableRow>
                        {sortGroup(list).map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <div className="flex min-w-0 flex-col">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={p.available ? "font-medium" : "font-medium text-muted-foreground line-through"}>
                                    {p.name}
                                  </span>
                                  {!p.available ? (
                                    <Badge variant="destructive">Недоступен</Badge>
                                  ) : null}
                                </div>
                                <span className="text-sm text-muted-foreground">
                                  {vendors.find((v) => v.id === p.vendorId)?.name ?? p.brand}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>{CATEGORY_LABELS[cat]}</TableCell>
                            <TableCell>{p.available ? `${p.tdp} Вт` : "—"}</TableCell>
                            <TableCell className="max-w-[260px] truncate">
                              {p.available ? (compatSummary(cat, p) || "—") : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {p.available ? (
                                <div className="flex justify-end gap-2 whitespace-nowrap">
                                  <Button variant="secondary" size="sm" onClick={() => openEdit(p)}>
                                    Редактировать
                                  </Button>
                                  <Button variant="ghost" size="sm" onClick={() => handleDeactivate(p)}>
                                    Деактивировать
                                  </Button>
                                </div>
                              ) : (
                                <Button variant="secondary" size="sm" onClick={() => handleReactivate(p)}>
                                  Активировать
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? "Редактировать компонент" : "Новый компонент"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave}>{editId ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <ComponentForm
          form={form}
          set={set}
          vendorMatches={vendorMatches}
        />
      </Modal>

      <Modal
        open={initOpen}
        onClose={() => setInitOpen(false)}
        title="Инициализировать справочник"
        description="Заменяет каталог эталонным набором компонентов. Не входящие в эталон компоненты будут удалены (связи в конфигурациях сохранятся как «недоступен»)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setInitOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" loading={initBusy} onClick={handleInitialize}>
              Переинициализировать
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Это действие затронет весь каталог. Названия вендоров будут восстановлены из
          эталонных брендов.
        </p>
      </Modal>
    </section>
  );
}

function ComponentForm({
  form,
  set,
  vendorMatches,
}: {
  form: FormState;
  set: (k: keyof FormState, v: string) => void;
  vendorMatches: string[];
}) {
  const compatFields = CATEGORY_FIELDS[form.category];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Категория" htmlFor="cmp-category" required>
          <Select value={form.category} onValueChange={(v) => set("category", v as ComponentCategory)}>
            <SelectTrigger id="cmp-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Вендор (торговая марка)" htmlFor="comp-vendor" required>
          <Input
            id="comp-vendor"
            list="vendor-suggestions"
            value={form.vendor}
            onChange={(e) => set("vendor", e.target.value)}
            placeholder="Intel, AMD, NVIDIA…"
          />
          <datalist id="vendor-suggestions">
            {vendorMatches.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Модель / линейка" htmlFor="comp-brand" required>
          <Input id="comp-brand" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Core i5-13400F" />
        </Field>
        <Field label="Цена, ₽" htmlFor="comp-price" required>
          <Input id="comp-price" type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
        </Field>
      </div>

      <div className="rounded-md bg-muted px-3 py-2 text-sm">
        <span className="text-muted-foreground">Название: </span>
        <span className="font-medium">
          {[form.vendor.trim(), form.brand.trim()].filter(Boolean).join(" ") || "—"}
        </span>
      </div>

      <Field label="TDP, Вт" htmlFor="comp-tdp" hint="Энергопотребление / мощность охлаждения — для CPU, GPU, RAM, storage и cooler.">
        <Input id="comp-tdp" type="number" min={0} value={form.tdp} onChange={(e) => set("tdp", e.target.value)} />
      </Field>

      {compatFields.length > 0 ? (
        <div className="flex flex-col gap-3 border-t pt-3">
          <h4 className="text-sm font-semibold">Карта совместимости</h4>
          {compatFields.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`comp-${f.key}`} hint={f.hint}>
              <CompatControl field={f} id={`comp-${f.key}`} value={form[f.key]} onChange={(v) => set(f.key, v)} />
            </Field>
          ))}
        </div>
      ) : null}

      <Field
        label="Характеристики (label: значение, по одному на строку)"
        htmlFor="comp-specs"
      >
        <Textarea id="comp-specs" value={form.specs} onChange={(e) => set("specs", e.target.value)} placeholder={"Сокет: LGA1700\nПамять: DDR5, до 128 ГБ"} />
      </Field>
    </div>
  );
}

function CompatControl({
  field,
  id,
  value,
  onChange,
}: {
  field: FieldMeta;
  id: string;
  value: string;
  onChange: (v: string) => void;
}) {
  switch (field.control) {
    case "number":
      return (
        <Input id={id} type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)} />
      );
    case "ram":
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DDR4">DDR4</SelectItem>
            <SelectItem value="DDR5">DDR5</SelectItem>
          </SelectContent>
        </Select>
      );
    case "ff":
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ATX">ATX</SelectItem>
            <SelectItem value="mATX">mATX</SelectItem>
            <SelectItem value="ITX">ITX</SelectItem>
          </SelectContent>
        </Select>
      );
    case "psu":
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ATX">ATX</SelectItem>
            <SelectItem value="SFX">SFX</SelectItem>
          </SelectContent>
        </Select>
      );
    case "benches":
      return (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      );
    case "text":
    default:
      return (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />
      );
  }
}
