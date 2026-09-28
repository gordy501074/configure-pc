import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Edit, Plus, RotateCcw, Trash2 } from "lucide-react";

import {
  Badge,
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
  useToast,
} from "../components/ui";
import { CATEGORY_LABELS, formatPrice } from "../lib/format";
import { isBuildCompleteValid } from "../lib/compatibility";
import { ComponentPicker } from "../components/shared/ComponentPicker";
import {
  createSellerReadyBuild,
  deleteSellerReadyBuild,
  fetchSellerBrands,
  fetchSellerReadyBuilds,
  fetchSellerSummaries,
  reactivateSellerReadyBuild,
  updateSellerReadyBuild,
  type ReadyBuildPartRef,
} from "../lib/api";
import type { ComponentCategory, Part, ReadyPc, SellerBrand, SellerSummary } from "../types";

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

const EMPTY_CHOSEN: Record<ComponentCategory, Part | null> = {
  cpu: null,
  gpu: null,
  motherboard: null,
  ram: null,
  storage: null,
  case: null,
  psu: null,
  cooler: null,
};

interface EditState {
  buildId: string | null;
  brand: string;
  model: string;
  chosen: Record<ComponentCategory, Part | null>;
}

export function ProfileReadyBuilds({
  sellerId,
  isAdmin = false,
}: {
  sellerId: string;
  isAdmin?: boolean;
}) {
  const { toast } = useToast();
  const [builds, setBuilds] = useState<ReadyPc[]>([]);
  const [brands, setBrands] = useState<SellerBrand[]>([]);
  const [sellers, setSellers] = useState<SellerSummary[]>([]);
  const [activeSellerId, setActiveSellerId] = useState(sellerId);
  const [loading, setLoading] = useState(true);
  const [showArchive, setShowArchive] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pickerCat, setPickerCat] = useState<ComponentCategory | null>(null);
  const [saving, setSaving] = useState(false);

  const active = useMemo(() => builds.filter((b) => !b.archived), [builds]);
  const archived = useMemo(() => builds.filter((b) => b.archived), [builds]);

useEffect(() => {
    if (!isAdmin) return;
    fetchSellerSummaries()
      .then((list) => {
        setSellers(list);
        setActiveSellerId((prev) =>
          list.some((s) => s.id === prev) ? prev : list[0]?.id ?? "",
        );
      })
      .catch(() => setSellers([]));
  }, [isAdmin]);

  const reload = useCallback(async () => {
    if (!activeSellerId) {
      setLoading(false);
      return;
    }
    try {
      const [b, br] = await Promise.all([
        fetchSellerReadyBuilds(activeSellerId),
        fetchSellerBrands(activeSellerId),
      ]);
      setBuilds(b);
      setBrands(br);
    } catch {
      toast("Не удалось загрузить готовые конфигурации", "error");
    } finally {
      setLoading(false);
    }
  }, [activeSellerId, toast]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const openCreate = () => {
    setEdit({
      buildId: null,
      brand: brands[0]?.brand ?? "",
      model: "",
      chosen: { ...EMPTY_CHOSEN },
    });
    setModalOpen(true);
  };

  const openEdit = (pc: ReadyPc) => {
    const chosen: Record<ComponentCategory, Part | null> = { ...EMPTY_CHOSEN };
    for (const cp of pc.parts) {
      if (cp.part) chosen[cp.category] = cp.part;
    }
    setEdit({
      buildId: pc.id,
      brand: pc.brand,
      model: modelFromName(pc.name, pc.brand),
      chosen,
    });
    setModalOpen(true);
  };

  const setEditField = <K extends keyof EditState>(key: K, value: EditState[K]) => {
    setEdit((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

const filledCount = useMemo(
    () => (edit ? CATEGORY_ORDER.filter((c) => edit.chosen[c]).length : 0),
    [edit],
  );

  const buildValid = useMemo(
    () =>
      edit
        ? isBuildCompleteValid(
            CATEGORY_ORDER.map((c) => ({ part: edit.chosen[c] })),
          )
        : false,
    [edit],
  );

  const handleSave = async () => {
    if (!edit) return;
    const brand = edit.brand.trim();
    const model = edit.model.trim();
    if (!brand || !model) {
      toast("Укажите бренд и модель", "error");
      return;
    }
    if (!buildValid) {
      toast("Заполните все 8 категорий доступными позициями с ценой", "error");
      return;
    }
    const parts: ReadyBuildPartRef[] = CATEGORY_ORDER.map((c) => ({
      category: c,
      partId: edit.chosen[c]!.id,
    }));
    setSaving(true);
    try {
      if (edit.buildId) {
        await updateSellerReadyBuild(activeSellerId, edit.buildId, {
          brand,
          model,
          parts,
        });
        toast("Конфигурация обновлена");
      } else {
        await createSellerReadyBuild(activeSellerId, { brand, model, parts });
        toast("Конфигурация создана");
      }
      setModalOpen(false);
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(
        message === "model_exists"
          ? "Конфигурация с такой моделью уже существует"
          : "Не удалось сохранить конфигурацию",
        "error",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (pc: ReadyPc) => {
    try {
      await deleteSellerReadyBuild(activeSellerId, pc.id);
      await reload();
      toast(`«${pc.name}» перемещён в архив`, "info");
    } catch {
      toast("Не удалось переместить в архив", "error");
    }
  };

  const handleReactivate = async (pc: ReadyPc) => {
    try {
      await reactivateSellerReadyBuild(activeSellerId, pc.id);
      await reload();
      toast(`«${pc.name}» восстановлен`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      toast(
        message === "model_exists"
          ? "Конфигурация с такой моделью уже активна"
          : "Не удалось восстановить конфигурацию",
        "error",
      );
    }
  };

  if (loading) return <EmptyState title="Загрузка…" description="Пожалуйста, подождите." />;

  return (
<section aria-label="Готовые конфигурации" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Готовые конфигурации</h2>
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin ? (
            <Select value={activeSellerId} onValueChange={setActiveSellerId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Выберите продавца" />
              </SelectTrigger>
              <SelectContent>
                {sellers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.company ? ` · ${s.company}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Badge variant="success">Активных: {active.length}</Badge>
          {archived.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setShowArchive((v) => !v)}>
              <Archive aria-hidden="true" />
              {showArchive ? "Скрыть архив" : `Показать архив: ${archived.length}`}
            </Button>
          ) : null}
          <Button onClick={openCreate} disabled={brands.length === 0}>
            <Plus aria-hidden="true" />
            Создать
          </Button>
        </div>
      </div>

      {brands.length === 0 ? (
        <EmptyState
          title="Сначала добавьте бренд"
          description="Готовая конфигурация создаётся от бренда продавца. Добавьте бренд во вкладке «Бренды»."
        />
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState
          title="Готовых конфигураций пока нет"
          description="Создайте первую конфигурацию из позиций вашего активного прайс-листа."
          actionLabel="Создать"
          onAction={openCreate}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {active.map((pc) => (
            <BuildCard
              key={pc.id}
              pc={pc}
              onEdit={() => openEdit(pc)}
              onArchive={() => handleArchive(pc)}
            />
          ))}
          {showArchive
            ? archived.map((pc) => (
                <BuildCard key={pc.id} pc={pc} archived onReactivate={() => handleReactivate(pc)} />
              ))
            : null}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={edit?.buildId ? "Редактировать конфигурацию" : "Новая конфигурация"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Отмена
            </Button>
<Button loading={saving} disabled={!buildValid} onClick={handleSave}>
              {edit?.buildId ? "Сохранить" : "Создать"}
            </Button>
          </>
        }
      >
        {edit ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Бренд" htmlFor="rb-brand" required>
                <Select value={edit.brand} onValueChange={(v) => setEditField("brand", v)}>
                  <SelectTrigger id="rb-brand" className="w-full">
                    <SelectValue placeholder="Выберите бренд" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.brand} value={b.brand}>
                        {b.brand}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Модель" htmlFor="rb-model" required hint="Например, Gaming 1440p">
                <Input
                  id="rb-model"
                  value={edit.model}
                  onChange={(e) => setEditField("model", e.target.value)}
                  placeholder="Gaming 1440p"
                />
              </Field>
            </div>

            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Название: </span>
              <span className="font-medium">
                {[edit.brand.trim(), edit.model.trim()].filter(Boolean).join(" ") || "—"}
              </span>
            </div>

            <div className="flex flex-col gap-3 border-t pt-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Состав</h4>
                <Badge variant="neutral">
                  {filledCount} / {CATEGORY_ORDER.length}
                </Badge>
              </div>
              {CATEGORY_ORDER.map((cat) => {
                const part = edit.chosen[cat];
                return (
                  <div key={cat} className="flex items-center justify-between gap-3">
                    <span className="w-32 shrink-0 font-medium">{CATEGORY_LABELS[cat]}</span>
                    {part ? (
                      <span className="min-w-0 flex-1 truncate text-sm">{part.name}</span>
                    ) : (
                      <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                        Выберите компонент
                      </span>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setPickerCat(cat)}
                    >
                      {part ? "Заменить" : "Выбрать"}
                    </Button>
                  </div>
                );
              })}
            </div>

            {pickerCat ? (
              <ComponentPicker
                open
                onClose={() => setPickerCat(null)}
                category={pickerCat}
                chosen={edit.chosen}
                sellerId={activeSellerId}
                onSelect={(p) => {
                  setEditField("chosen", { ...edit.chosen, [pickerCat]: p });
                  setPickerCat(null);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

function BuildCard({
  pc,
  archived = false,
  onEdit,
  onArchive,
  onReactivate,
}: {
  pc: ReadyPc;
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onReactivate?: () => void;
}) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold">{pc.name}</span>
            {archived ? <Badge variant="neutral">В архиве</Badge> : null}
            {!archived && pc.valid === false ? (
              <Badge variant="destructive">Невалидна</Badge>
            ) : null}
          </div>
          <span className="text-sm text-muted-foreground">{pc.brand}</span>
        </div>
        <span className="font-bold">{formatPrice(pc.price)}</span>
      </div>
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span>{pc.tdp} Вт</span>
        <span>{pc.reviewCount} отз.</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {pc.parts.filter((cp) => cp.part).length}/8 компонентов
        </span>
        {!archived && onEdit ? (
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Edit aria-hidden="true" />
            Редактировать
          </Button>
        ) : null}
        {!archived && onArchive ? (
          <Button variant="ghost" size="sm" onClick={onArchive}>
            <Trash2 aria-hidden="true" />
            В архив
          </Button>
        ) : null}
        {archived && onReactivate ? (
          <Button variant="secondary" size="sm" onClick={onReactivate}>
            <RotateCcw aria-hidden="true" />
            Восстановить
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Recover the model suffix from a full build name and its brand. */
function modelFromName(name: string, brand: string): string {
  const n = String(name ?? "").trim();
  const b = String(brand ?? "").trim();
  if (!b) return n;
  if (n.toLowerCase().startsWith(b.toLowerCase())) return n.slice(b.length).trim();
  return n;
}
