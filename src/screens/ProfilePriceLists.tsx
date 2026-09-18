import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";

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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "../components/ui";
import { CATEGORY_LABELS, formatDate, formatPrice } from "../lib/format";
import { useSort } from "../lib/useSort";
import { SortableTh } from "../components/ui/SortableTh";
import {
  addPriceListItems,
  createPriceList,
  deletePriceListItem,
  deletePriceList,
  fetchPriceListMissing,
  fetchPriceLists,
  fetchParts,
  fetchSellerSummaries,
  renamePriceList,
  setActivePriceList,
  upsertPriceListItem,
} from "../lib/api";
import type { PriceList, Part, PriceListItem, SellerSummary } from "../types";

export function ProfilePriceLists({
  sellerId,
  isAdmin = false,
}: {
  sellerId: string;
  isAdmin?: boolean;
}) {
  const { toast } = useToast();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [sellers, setSellers] = useState<SellerSummary[]>([]);
  const [sellerOf, setSellerOf] = useState<Record<string, SellerSummary>>({});
  const [loading, setLoading] = useState(true);
  const [openListId, setOpenListId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSellerId, setCreateSellerId] = useState<string>("");
  const [renameTarget, setRenameTarget] = useState<PriceList | null>(null);
  const [renameName, setRenameName] = useState("");

  // Add-part modal state.
  const [addOpen, setAddOpen] = useState(false);
  const [addCatalog, setAddCatalog] = useState<Part[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addAll, setAddAll] = useState(false);
  const [partPickerOpen, setPartPickerOpen] = useState(false);
  const [partPickerList, setPartPickerList] = useState<Part[]>([]);
  const [editPart, setEditPart] = useState<{ listId: string; partId: string } | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const { sort, toggle, sorted } = useSort();

  const sortItems = (items: PriceListItem[]): PriceListItem[] =>
    sorted(items, (it: PriceListItem) => {
      switch (sort?.key) {
        case "code": return it.partId;
        case "name": return it.name ?? "";
        case "category": return it.category ?? "";
        case "price": return it.price;
        default: return it.partId;
      }
    });

  // Resolve the owner seller for a price list (admin sees lists owned by others).
  const ownerOf = (listId: string): string =>
    sellerOf[listId]?.id ?? sellerId;

  const reload = useCallback(async () => {
    try {
      if (isAdmin) {
        // Admin: collect the price lists of every seller, remembering the owner.
        const sellerList = await fetchSellerSummaries();
        const all: PriceList[] = [];
        const ownerById: Record<string, SellerSummary> = {};
        for (const s of sellerList) {
          for (const pl of await fetchPriceLists(s.id)) {
            all.push(pl);
            ownerById[pl.id] = s;
          }
        }
        setSellers(sellerList);
        setSellerOf(ownerById);
        setLists(all);
      } else {
        setLists(await fetchPriceLists(sellerId));
      }
    } catch {
      toast("Не удалось загрузить прайс-листы", "error");
    } finally {
      setLoading(false);
    }
  }, [isAdmin, sellerId, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    if (!createName.trim()) {
      toast("Укажите название прайс-листа", "error");
      return;
    }
    const targetSeller = isAdmin ? createSellerId : sellerId;
    if (!targetSeller) {
      toast("Выберите продавца", "error");
      return;
    }
    try {
      await createPriceList(targetSeller, createName.trim());
      setCreateOpen(false);
      setCreateName("");
      setCreateSellerId("");
      await reload();
      toast("Прайс-лист создан");
    } catch {
      toast("Не удалось создать прайс-лист", "error");
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      await renamePriceList(ownerOf(renameTarget.id), renameTarget.id, renameName.trim());
      setRenameTarget(null);
      await reload();
      toast("Прайс-лист переименован");
    } catch {
      toast("Не удалось переименовать", "error");
    }
  };

  const handleActivate = async (listId: string) => {
    try {
      await setActivePriceList(ownerOf(listId), listId);
      await reload();
      toast("Прайс-лист активирован");
    } catch {
      toast("Не удалось активировать", "error");
    }
  };

  const handleDelete = async (listId: string) => {
    try {
      await deletePriceList(ownerOf(listId), listId);
      if (openListId === listId) setOpenListId(null);
      await reload();
      toast("Прайс-лист удалён");
    } catch {
      toast("Не удалось удалить", "error");
    }
  };

  const handleDeleteItem = async (listId: string, partId: string) => {
    try {
      await deletePriceListItem(ownerOf(listId), listId, partId);
      await reload();
      toast("Позиция удалена", "info");
    } catch {
      toast("Не удалось удалить позицию", "error");
    }
  };

  const openPartPicker = async () => {
    setPartPickerOpen(true);
    try {
      setPartPickerList(await fetchParts(undefined, true));
    } catch {
      setPartPickerList([]);
    }
  };

  const handlePickPart = async (p: Part) => {
    if (!openListId) return;
    try {
      await upsertPriceListItem(ownerOf(openListId), openListId, p.id, 0);
      setPartPickerOpen(false);
      await reload();
      toast(`«${p.name}» добавлено (цена 0 = недоступно)`);
    } catch {
      toast("Не удалось добавить компонент", "error");
    }
  };

  const openAddMissing = async () => {
    if (!openListId) return;
    setSelected(new Set());
    setAddAll(false);
    setAddOpen(true);
    try {
      setAddCatalog(await fetchPriceListMissing(ownerOf(openListId), openListId, true));
    } catch {
      setAddCatalog([]);
    }
  };

  const togglePart = (partId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  };

  const handleAddMissing = async () => {
    if (!openListId) return;
    const ids = addAll ? addCatalog.map((p) => p.id) : Array.from(selected);
    if (ids.length === 0) {
      toast("Выберите компоненты", "info");
      return;
    }
    try {
      const res = await addPriceListItems(ownerOf(openListId), openListId, ids);
      setAddOpen(false);
      await reload();
      toast(`Добавлено: ${res.added}`, "success");
    } catch {
      toast("Не удалось добавить компоненты", "error");
    }
  };

  const openEditPrice = (listId: string, partId: string, currentPrice?: number) => {
    setEditPart({ listId, partId });
    setEditPrice(currentPrice !== undefined ? String(currentPrice) : "");
  };

  const handleSavePrice = async () => {
    if (!editPart) return;
    const price = Number(editPrice);
    if (!Number.isFinite(price) || price < 0) {
      toast("Некорректная цена", "error");
      return;
    }
    try {
      await upsertPriceListItem(ownerOf(editPart.listId), editPart.listId, editPart.partId, price);
      setEditPart(null);
      await reload();
      toast("Цена обновлена");
    } catch {
      toast("Не удалось сохранить цену", "error");
    }
  };

  if (loading) return <EmptyState title="Загрузка…" description="Пожалуйста, подождите." />;

  return (
    <section aria-label="Прайс-листы" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Прайс-листы</h2>
        <Button onClick={() => { setCreateSellerId(isAdmin ? sellers[0]?.id ?? "" : ""); setCreateOpen(true); }}>
          <Plus aria-hidden="true" />
          Создать прайс-лист
        </Button>
      </div>

      {lists.length === 0 ? (
        <EmptyState
          title="Прайс-листов пока нет"
          description="Создайте прайс-лист, чтобы выставить цены на компоненты."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {lists.map((l) => (
            <Card key={l.id} className="gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="text-lg font-semibold text-left no-underline hover:underline"
                    onClick={() => setOpenListId(l.id === openListId ? null : l.id)}
                  >
                    {l.name}
                  </button>
                  {l.isActive ? <Badge variant="success">Активный</Badge> : null}
                  <Badge variant="neutral">Позиций: {l.items.length}</Badge>
                  <span className="text-sm text-muted-foreground">
                    Создан: {formatDate(l.createdAt)}
                  </span>
                  {isAdmin && sellerOf[l.id] ? (
                    <Badge variant="neutral">
                      Продавец: {sellerOf[l.id].name}
                      {sellerOf[l.id].company ? ` · ${sellerOf[l.id].company}` : ""}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!l.isActive ? (
                    <Button variant="secondary" size="sm" onClick={() => handleActivate(l.id)}>
                      Активировать
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" onClick={() => { setRenameTarget(l); setRenameName(l.name); }}>
                    <Pencil aria-hidden="true" />
                    Переименовать
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(l.id)}>
                    <Trash2 aria-hidden="true" />
                    Удалить
                  </Button>
                </div>
              </div>

              {openListId === l.id ? (
                <div className="flex flex-col gap-3 border-t pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => openAddMissing()}>
                      Добавить компоненты из справочника
                    </Button>
                    <Button variant="secondary" size="sm" onClick={openPartPicker}>
                      Добавить компонент
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTh label="Код компонента" column="code" sort={sort} onSort={toggle} />
                        <SortableTh label="Название компонента" column="name" sort={sort} onSort={toggle} />
                        <SortableTh label="Категория" column="category" sort={sort} onSort={toggle} />
                        <SortableTh label="Цена" column="price" sort={sort} onSort={toggle} align="right" />
                        <TableHead className="text-right">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {l.items.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-muted-foreground">
                            Позиций нет.
                          </TableCell>
                        </TableRow>
                      ) : (
                        sortItems(l.items).map((item) => (
                          <TableRow key={item.partId}>
                            <TableCell className="font-mono text-xs">{item.partId}</TableCell>
                            <TableCell>{item.name ?? "—"}</TableCell>
                            <TableCell>
                              {item.category ? CATEGORY_LABELS[item.category] ?? item.category : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {item.price > 0 ? formatPrice(item.price) : "Недоступно"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2 whitespace-nowrap">
                                <Button
                                  variant="secondary"
                                  size="icon"
                                  className="size-8"
                                  title="Редактировать цену"
                                  aria-label="Редактировать цену"
                                  onClick={() => openEditPrice(l.id, item.partId, item.price)}
                                >
                                  <Pencil aria-hidden="true" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  title="Удалить"
                                  aria-label="Удалить"
                                  onClick={() => handleDeleteItem(l.id, item.partId)}
                                >
                                  <Trash2 aria-hidden="true" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {/* Create */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Новый прайс-лист"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate}>Создать</Button>
          </>
        }
      >
        <Field label="Название" htmlFor="price-list-name" required>
          <Input
            id="price-list-name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Например, Основной"
          />
        </Field>
        {isAdmin ? (
          <Field label="Продавец" htmlFor="price-list-seller" required>
            <Select
              value={createSellerId}
              onValueChange={setCreateSellerId}
            >
              <SelectTrigger id="price-list-seller" className="w-full">
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
          </Field>
        ) : null}
        <p className="text-sm text-muted-foreground">
          Первый прайс-лист продавца становится активным автоматически.
        </p>
      </Modal>

      {/* Rename */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Переименовать прайс-лист"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Отмена</Button>
            <Button onClick={handleRename}>Сохранить</Button>
          </>
        }
      >
        <Field label="Название" htmlFor="price-list-rename" required>
          <Input id="price-list-rename" value={renameName} onChange={(e) => setRenameName(e.target.value)} />
        </Field>
      </Modal>

      {/* Add a single part from catalog */}
      <Modal
        open={partPickerOpen}
        onClose={() => setPartPickerOpen(false)}
        title="Добавить компонент из справочника"
        footer={
          <Button variant="ghost" onClick={() => setPartPickerOpen(false)}>Закрыть</Button>
        }
      >
        <div className="flex flex-col gap-2">
          {partPickerList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет доступных компонентов.</p>
          ) : (
            partPickerList.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex items-center justify-between gap-3 rounded-md border border-input px-3 py-2 text-left hover:bg-accent/50"
                onClick={() => handlePickPart(p)}
              >
                <span className="truncate font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground">{CATEGORY_LABELS[p.category]}</span>
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* Add many from catalog (multi-select) */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Добавить компоненты из справочника"
        description="Выберите отсутствующие в прайсе компоненты. Добавленные получат цену 0 (недоступно)."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button onClick={handleAddMissing}>Добавить</Button>
          </>
        }
      >
        <div className="mb-2 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addAll}
              onChange={(e) => setAddAll(e.target.checked)}
            />
            Добавить все
          </label>
        </div>
        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {addCatalog.length === 0 ? (
            <p className="text-sm text-muted-foreground">Все компоненты уже в прайсе.</p>
          ) : (
            addCatalog.map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
                <input
                  type="checkbox"
                  checked={addAll || selected.has(p.id)}
                  disabled={addAll}
                  onChange={() => togglePart(p.id)}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                <span className="text-xs text-muted-foreground">{CATEGORY_LABELS[p.category]}</span>
              </label>
            ))
          )}
        </div>
      </Modal>

      {/* Edit item price */}
      <Modal
        open={editPart !== null}
        onClose={() => setEditPart(null)}
        title="Редактировать цену"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditPart(null)}>Отмена</Button>
            <Button onClick={handleSavePrice}>Сохранить</Button>
          </>
        }
      >
        <Field label="Цена, ₽" htmlFor="price-item-price" hint="0 = компонент недоступен для заказа">
          <Input
            id="price-item-price"
            type="number"
            min={0}
            value={editPrice}
            onChange={(e) => setEditPrice(e.target.value)}
          />
        </Field>
      </Modal>
    </section>
  );
}