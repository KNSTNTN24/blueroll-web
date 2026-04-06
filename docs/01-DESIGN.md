# Blueroll Web v2 — Дизайн и организация интерфейса

## Философия

Desktop-first SaaS. Референсы: Linear, Vercel Dashboard, Notion, Stripe Dashboard.
Не адаптивная мобилка, а полноценное рабочее место менеджера ресторана.

---

## Оболочка (Shell)

### Сайдбар — левая навигация
- **Ширина**: 220px, коллапсируется до 52px (icon rail)
- **Верх**: логотип Blueroll (зелёный квадрат "B" + текст)
- **Основная навигация** (сверху вниз):
  - Dashboard
  - Checklists
  - Recipes
  - Menu (Recipes tab + Allergens tab)
  - Allergens (отдельная страница с матрицей)
  - Reports
  - Team
  - Incidents
  - Deliveries
  - Suppliers
  - Documents
  - Diary
- **Нижняя секция** (отделена бордером):
  - Settings
  - Collapse/Expand кнопка
- **Визуал**:
  - Иконки Lucide, 16×16, strokeWidth 1.5 (неактивные), 2 (активные)
  - Активный пункт: emerald-50 фон, emerald-700 текст
  - Неактивный: muted-foreground, hover → accent фон
  - Текст 13px, font-medium
  - При коллапсе — tooltip справа при наведении

### Топбар — верхняя панель
- **Высота**: 53px
- **Лево**: Название бизнеса + FSA рейтинг бейдж
- **Центр**: Поисковая строка (⌘K для Command Palette)
- **Право**: Колокольчик уведомлений + User menu (аватар + имя + dropdown)
- **Визуал**: border-bottom 1px, bg-white/80 backdrop-blur

### Контент
- **Max-width**: 1152px (max-w-6xl)
- **Padding**: 24px горизонтально, 24px вертикально
- **Scroll**: только контент, сайдбар и топбар фиксированы

---

## Цвета

### Бренд
| Токен | Hex | Использование |
|-------|-----|---------------|
| Emerald 600 | #059669 | Primary кнопки, активные состояния, positive status |
| Emerald 700 | #047857 | Primary hover |
| Emerald 50 | #ecfdf5 | Active nav фон, success фон |
| Emerald 100 | #d1fae5 | Аватары fallback |

### Семантические
| Статус | Фон | Текст | Бордер |
|--------|-----|-------|--------|
| Success | emerald-50 | emerald-700 | emerald-200 |
| Warning | amber-50 | amber-700 | amber-200 |
| Error | red-50 | red-700 | red-200 |
| Info | blue-50 | blue-700 | blue-200 |
| Neutral | gray-50 | gray-600 | gray-200 |

### Общие
- **Фон страницы**: oklch(0.995) — почти белый
- **Карточки/таблицы**: белый (#fff)
- **Бордеры**: oklch(0.91) — тонкие серые, 1px
- **Текст основной**: oklch(0.145) — почти чёрный
- **Текст вторичный**: oklch(0.52) — серый
- **Тени**: НЕТ. Только бордеры.

---

## Типографика

- **Шрифт**: Inter (Google Fonts)
- **Tracking**: tight на заголовках (20px+), default на теле

### Шкала размеров
| Размер | Использование |
|--------|---------------|
| 10px | Теги, role badges, мелкие лейблы |
| 11px | Суб-мета, счётчики, fine print |
| 12px | Metadata, helper text, timestamps |
| **13px** | **Основной UI текст** — навигация, таблицы, кнопки, описания |
| 14px | Form labels (если отдельно), body text |
| 16px | Крупный body (редко) |
| 20px | Заголовки страниц |
| 24px | Метрики (цифры) |

### Веса
- **Semibold (600)**: заголовки, метрики
- **Medium (500)**: навигация, headers таблиц, кнопки, labels
- **Normal (400)**: body, описания

### Числа
- `tabular-nums` на всех числах в таблицах и метриках

---

## Компоненты

### Кнопки
- **Primary**: bg-emerald-600, hover bg-emerald-700, text-white. Одна на секцию.
- **Secondary**: variant="outline"
- **Ghost**: icon-only, для action-кнопок в таблицах
- **Размер**: преимущественно `sm` (text-[12px])

### Таблицы данных
- Контейнер: rounded-lg border border-border bg-white
- Header: text-[12px] font-medium text-muted-foreground, sticky
- Строки: hover:bg-accent/50, divide-y divide-border
- Действия: icon buttons справа
- БЕЗ теней

### Статус-бейджи (StatusBadge)
- Pill + dot indicator
- text-[11px] font-medium
- Семантические цвета (см. таблицу выше)

### Карточки
- rounded-lg border border-border bg-white p-4
- Заголовок: text-[13px] font-medium
- БЕЗ теней

### Формы
- Labels: text-[13px] font-medium
- Helper text: text-[12px] text-muted-foreground
- Ошибки: text-[12px] text-destructive
- Между полями: space-y-4
- Label к input: space-y-1.5
- Длинные формы: sticky footer с Save/Cancel

### Пустые состояния (EmptyState)
- Центрировано, иконка в bordered контейнере
- Заголовок: text-[14px] font-medium
- Описание: text-[13px] text-muted-foreground
- Primary CTA кнопка

### Загрузка
- Skeleton placeholders, повторяющие финальный layout
- Спиннер: animate-spin rounded-full border-2 border-emerald-600 border-t-transparent

---

## Взаимодействия

- **⌘K Command Palette**: навигация + быстрые действия
- **Клавиатура**: Enter = submit, Escape = close
- **Toast уведомления**: Sonner, bottom-right
- **Оптимистичные обновления**: через TanStack Query invalidation

---

## Иконки

- **Библиотека**: Lucide React
- **Навигация**: 16×16, strokeWidth 1.5 / 2
- **Inline**: 14×14 (h-3.5 w-3.5)
- **Feature**: 20×20 (h-5 w-5)

---

## Border Radius

- `rounded-md` (6px): кнопки, инпуты, nav items
- `rounded-lg` (8px): карточки, таблицы, панели
- `rounded-full`: аватары, status dots, badges
- `rounded-xl` (12px): контейнеры иконок в empty states
