# Blueroll Web v2 — Описание функционала

---

## 1. Авторизация

### Логин
- Поля: email, пароль
- При успешном логине: проверка профиля → проверка подписки → dashboard или paywall
- Если нет профиля → /onboarding
- Ошибки: "Invalid email or password", "Email not confirmed"
- Ссылка "Don't have an account? → Create account" → ведёт на онбординг

### Регистрация
- Происходит внутри онбординга (последний шаг)
- Поля: email, пароль, подтверждение пароля
- После регистрации сразу создаётся бизнес (или join team) — без отдельного setup экрана
- Если email уже занят → "This email is already registered. Try signing in."

### Выход
- Кнопка в Settings и в user dropdown
- Очищает сессию, редирект на /login

---

## 2. Дашборд

### Метрики (4 карточки)
- Задачи выполнены: X/Y (процент)
- Открытые инциденты: число
- Сотрудники на месте: число
- FSA рейтинг: текущий

### Check-in/Check-out
- Выбор настроения (6 эмодзи: 😊🔥😴💪🤒😎) → кнопка Check in
- Если уже checked in → показывает время и кнопку Check out
- При check-in/out создаётся запись в staff_checkins
- Менеджеры получают уведомление

### Мои задачи (My Tasks)
- Список активных чеклистов, назначенных на роль текущего пользователя
- Для каждого: название, частота, кол-во пунктов, дедлайн
- Статус: Pending / Completed / Signed Off
- Период: считается от начала текущего дня (daily), недели (weekly), месяца (monthly)

### Задачи команды (Team Tasks) — только для менеджеров
- Список сотрудников on-site с их check-in временем и настроением

### Открытые инциденты
- Последние 5 открытых инцидентов
- Тип (complaint/incident), описание, время

### Уведомления
- Последние 5, непрочитанные подсвечены
- Заголовок, сообщение, время

---

## 3. Чеклисты

### Список чеклистов
**Таб "Today":**
- Показывает активные шаблоны, назначенные на роль текущего пользователя
- Для каждого: статус (Pending / Completed / Awaiting Sign-off / Signed Off)
- Статус определяется по наличию completion за текущий период
- Клик → переход на заполнение

**Таб "Library" (только менеджеры):**
- Все шаблоны бизнеса (активные и неактивные)
- Таблица: название, частота, кол-во пунктов, назначенные роли, active toggle
- Кнопки: редактировать, история

### Заполнение чеклиста (Detail)
**Режимы:**
- Fill — заполнение (если за период ещё нет completion)
- Read-only — просмотр (если уже заполнен)
- Sign-off — подпись менеджером (если template имеет supervisor_role)

**Типы пунктов:**
- tick — чекбокс (true/false)
- temperature — числовое поле с диапазоном min/max, автофлаг при выходе за пределы
- text — текстовое поле
- yes_no — две кнопки Yes/No, автофлаг при "No"
- photo — загрузка фото (на вебе: file upload)

**При сабмите:**
1. Создаётся запись в checklist_completions
2. Для каждого пункта создаётся checklist_response (value, notes, flagged)
3. Если есть flagged пункты → уведомление менеджерам
4. Если есть supervisor_role → уведомление супервайзеру о необходимости подписи

### Создание/редактирование шаблона (менеджеры)
- Поля: название, описание, частота, назначенные роли, supervisor_role, deadline_time
- Динамический список пунктов (drag-перемещение или move up/down)
- Каждый пункт: название, тип, required, min/max/unit (для temperature)

### История (History)
- Все completions для шаблона, отсортированные по дате
- Раскрываемые карточки с ответами по каждому пункту
- Показывает flagged пункты

### Дефолтные шаблоны
При создании нового бизнеса автоматически засеиваются 6 шаблонов (active: false):
1. Fridge & Freezer Temperatures (daily, 10:00)
2. Daily Opening Checks (daily, 09:00)
3. Delivery Acceptance (daily)
4. End of Day Closing (daily, 23:00)
5. Weekly Deep Clean & Calibration (weekly)
6. 4-Weekly HACCP Review (four_weekly) — ревью актуальности HACCP Pack

---

## 4. Рецепты

### Список
- Таблица: название, категория, аллергены (бейджи), dietary labels, статус (Active/Inactive)
- Фильтры: поиск по тексту, фильтр по категории
- Категории: starter, main, dessert, side, sauce, drink, cocktail, beverage, other

### Детальный просмотр
- Название, описание, категория
- Метод приготовления, температура, время
- Инструкции (текст)
- Таблица ингредиентов: название, количество, единица, аллергены
- Dietary labels (вычисляются из ингредиентов): Vegan, Vegetarian, Gluten-Free, Dairy-Free
- Extra care flags (eggs, rice, pulses, shellfish)
- Reheating instructions, hot holding, chilling method
- **Freezing instructions** — как замораживать
- **Defrosting instructions** — как размораживать
- Кнопки менеджера: Edit, Activate/Deactivate, Delete

### Создание рецепта
- Поля: название, описание, категория, инструкции, метод, температура, время, единица
- Дополнительные поля: reheating_instructions, chilling_method, **freezing_instructions**, **defrosting_instructions**, hot_holding_required, extra_care_flags
- Динамический список ингредиентов: название, количество, единица, аллергены (14 EU)
- При сохранении: проверка существования ингредиента по имени → создание если нет → создание recipe + recipe_ingredients

### AI Import
- Три таба: Text (вставка текста), PDF (загрузка файла), Photo (загрузка фото)
- Отправка на Edge Function `import-recipe` (Claude API)
- Результат: распарсенный рецепт с редактируемыми полями (включая freezing/defrosting)
- Кнопка "Save Recipe" → стандартная логика создания

### Логика Active/Inactive
- Активный рецепт = показывается в Меню и в Аллергенах
- Неактивный = не показывается, но сохраняется в базе

---

## 5. Меню

- **Это НЕ отдельная сущность.** Меню = активные рецепты.
- Два таба: Recipes и Allergens (как в мобилке)
- Таб Recipes: таблица активных рецептов с аллергенами, dietary, статусом
- Таб Allergens: матрица рецептов × 14 EU аллергенов
- Экспорт: CSV и PDF (print)
- Менеджер может toggle active/inactive прямо из меню

---

## 6. Матрица аллергенов (отдельная страница)

- Все активные рецепты × 14 EU аллергенов
- Два режима: Card view (сгруппировано по категории) и Matrix view (таблица)
- Поиск по названию рецепта
- Сортировка: по имени, категории, кол-ву аллергенов
- Экспорт: CSV и PDF
- 14 аллергенов: gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs

---

## 7. Отчёты (Reports)

- Фильтры: диапазон дат (от/до), выбор шаблонов чеклистов
- Загрузка completions с responses за период
- Сводка: всего completions, всего пунктов, flagged, % compliance
- Таблица: per-completion breakdown (дата, название чеклиста, кто заполнил, flagged)
- Экспорт: PDF (print)

---

## 8. Команда (Team)

### Список
- Таблица: аватар (initials), имя, email, роль (цветной бейдж), дата вступления, on-site статус
- Цвета ролей: owner=emerald, manager=blue, chef=amber, kitchen_staff=gray, front_of_house=purple

### Инвайт (только owner/manager)
- Поля: email, роль (без owner)
- Генерация токена: 32 символа, case-sensitive, mixed chars
- Вставка в таблицу invites: business_id, email, role, token, invited_by, expires_at (7 дней)
- После создания показывается:
  - Токен крупно с кнопкой Copy
  - Инструкция для нового члена команды:
    1. Откройте приложение или сайт
    2. Нажмите "Create Account"
    3. Выберите "Joining a team"
    4. Вставьте инвайт-код

### Роли
- owner — полный доступ
- manager — всё кроме удаления бизнеса
- chef — рецепты + чеклисты
- kitchen_staff — чеклисты
- front_of_house — чеклисты

---

## 9. Инциденты

- Типы: complaint, incident
- Статусы: open, resolved
- Фильтры: All / Open / Resolved
- Таблица: дата, тип, описание, кто сообщил, статус, действия
- Создание: тип, описание, action_taken, follow_up, дата
- Resolving: resolved_by, resolved_at, resolved_notes
- Менеджер может редактировать и удалять
- При создании → уведомление менеджерам
- При resolving → уведомление тому кто сообщил

---

## 10. Доставки (Deliveries)

- Таблица: дата, поставщик, кто принял, температура, фото, заметки
- Создание: выбор поставщика, дата/время, температура, заметки
- Температура с цветовой индикацией (красный если вне нормы)

---

## 11. Поставщики (Suppliers)

- Таблица: название, контакт, телефон, адрес, товары, дни доставки
- CRUD через диалоги
- Дни доставки: мультивыбор Mon-Sun
- Только менеджер может добавлять/редактировать/удалять

---

## 12. Документы (Documents)

### Список
- Фильтр по категориям: certificate, license, policy, instruction, contract, inspection, training, other
- Поиск по названию
- Таблица: название, категория, файл, размер, кто загрузил, срок действия, действия
- Предупреждение: красный если истёк, amber если истекает в течение 30 дней

### Загрузка
- Поля: файл, название, описание, категория, уровень доступа (all / managers_only / owner_only), дата истечения
- Файл загружается в Supabase Storage → bucket "documents" → path: {businessId}/{timestamp}_{fileName}
- Создаётся запись в таблице documents

### Детальный просмотр
- Метаданные, signed URL для скачивания
- Управление уровнем доступа (owner)
- Удаление (owner/manager)

---

## 13. Дневник (Diary)

- Навигация по датам (prev/next/today)
- За выбранную дату показывает:
  - Заполненные чеклисты (кто, когда, какой)
  - Инциденты (тип, описание, статус)
- Таймлайн формат
- Экспорт

---

## 14. Уведомления (Notifications)

- Список: иконка по типу, заголовок, сообщение, relative timestamp
- Типы: checklist, incident, team, checkin, document, haccp
- Mark as read по клику
- "Mark all as read" кнопка
- Лимит: 50 последних

### 10 типов уведомлений (создаются автоматически):
1. Check-in → менеджерам
2. Check-out → менеджерам
3. Новый инцидент → менеджерам
4. Инцидент resolved → тому кто сообщил
5. Просроченный чеклист (deadline прошёл) → назначенным ролям + менеджерам
6. Flagged item (вне диапазона) → менеджерам
7. Sign-off required → supervisor role
8. Истекающий документ (30/7/1 день) → менеджерам
9. Новый член команды → менеджерам
10. HACCP Review overdue (4-week check просрочен) → owner + managers

---

## 15. Настройки (Settings)

### Профиль
- Имя (редактируемое)
- Email (readonly)
- Роль (readonly)
- Аватар (readonly на вебе, или upload)

### Бизнес
- Название (readonly)
- Адрес (readonly)
- FSA рейтинг (readonly)

### Действия
- Sign out
- Удаление аккаунта (через Edge Function delete-account — каскадное удаление всех данных)

---

## 16. Платежи и подписка

### Stripe (веб)
- Edge Function `create-subscription`: создаёт Stripe Customer + Checkout Session (14-day trial)
- Edge Function `manage-subscription`: Stripe Customer Portal (смена карты, отмена)
- Цена: **£14.99/мес** (price_id: `price_1TEVMUHaq4vjSIKeWZNDhuFg`)
- Триал: 14 дней бесплатно
- Success URL: `https://app.blueroll.app/dashboard`
- Cancel URL: `https://app.blueroll.app/paywall`

### Paywall экран (/paywall)
- Полноэкранный emerald gradient
- Заголовок: "Everything you need for food safety"
- 6 фич со списком (чеклисты, AI import, аллергены, отчёты, команда, документы)
- CTA: "Start free trial" + "then £14.99/mo after 14 days"
- Подвал: "14-day free trial. Cancel anytime." + ссылки Terms/Privacy

### Гейтинг
- Без активной подписки → redirect на /paywall
- Проверяется `businesses.subscription_status`
- Допуск: `active`, `trialing`
- Блокировка: `canceled`, `past_due`, `null`
- Join-юзер пропускает paywall если бизнес уже оплачен owner'ом

### В Settings
- Секция "Subscription": текущий статус, дата окончания триала/подписки
- Кнопка "Manage subscription" → Stripe Customer Portal
- Кнопка "Upgrade" если нет подписки

---

## 17. HACCP Pack

### Концепция
Интерактивный генератор SFBB-документации (Safer Food, Better Business) для EHO-инспекций. Документ **автоматически заполняется из данных, которые бизнес уже ведёт в Blueroll** — рецепты, чеклисты, документы, поставщики, команда. Менеджер дозаполняет вручную то, что система не покрывает.

### Режим автозаполнения
- **Toggle "Auto-fill from Blueroll data"** — включен по умолчанию
- Когда включен: поля с данными из системы обновляются live, помечены бейджем "Auto"
- Когда выключен: все поля ручные, auto-данные не перезаписывают введённое
- Если менеджер руками переписал auto-поле — его версия приоритетнее (override)

### Источники автозаполнения

| Источник в Blueroll | Что заполняется в HACCP Pack |
|---------------------|------------------------------|
| Чеклисты (templates) | Opening & Closing Checks, Cleaning Schedule, Daily Diary, Temperature Probes |
| Рецепты (cooking_method, cooking_temp) | Cooking Safely — список блюд и методов, Menu Checks |
| Рецепты (extra_care_flags) | Extra Care Foods — яйца, рис, бобовые, моллюски |
| Рецепты (reheating_instructions) | Reheating — какие блюда разогреваются и как |
| Рецепты (hot_holding_required) | Hot Holding — какие блюда на горячем |
| Рецепты (chilling_method) | Chilling Down Hot Food — методы охлаждения |
| Рецепты (freezing_instructions) | Freezing — как замораживаются продукты |
| Рецепты (defrosting_instructions) | Defrosting — как размораживаются продукты |
| Рецепты (ингредиенты: мясо, рыба, птица) | Separating Foods — какие сырые продукты от чего отделять |
| Рецепты (ингредиенты: ready-to-eat) | Ready-to-Eat — список RTE-продуктов |
| Аллергены из рецептов | Food Allergies — аллергенная матрица + список по блюдам |
| Документы (category=certificate, training) | Training — сертификаты персонала |
| Документы (category=contract, inspection) | Pest Control — контракт на дезинсекцию |
| Документы (category=policy, instruction) | Cleaning Schedule — расписание уборки |
| Поставщики (suppliers) | Suppliers — список с контактами |
| Поставщики (delivery_days) | Separating Foods — расписание доставок |
| Команда (profiles + roles) | Training — ответственные лица и роли |
| Доставки (product_temperature) | Chilled Storage — история температур при приёмке |

### 5 разделов

**1. Cross-Contamination** (красный) — 6 методов:
- Personal Hygiene — toggles + тексты (одежда, раздевалка)
- Cloths — toggles + тексты (грязные/чистые)
- Separating Foods — тексты (**авто: расписание доставок из Suppliers, сырые продукты из Recipes**)
- Food Allergies — тексты + файл (**авто: аллергенная матрица, список ингредиентов-аллергенов по блюдам**)
- Contamination Prevention — toggles + тексты
- Pest Control — тексты + файл (**авто: контракт из Documents**)

**2. Cleaning** (фиолетовый) — 4 метода:
- Handwashing — toggles
- Cleaning Effectively — toggles
- Clear & Clean As You Go — toggles + текст
- Cleaning Schedule — toggle + файл (**авто: шаблон чеклиста cleaning + документ**)

**3. Chilling** (бирюзовый) — 4 метода:
- Chilled Storage — toggles + текст + select (**авто: метод проверки из чеклиста температуры**)
- Chilling Down Hot Food — toggles + текст (**авто: из рецептов с chilling_method**)
- Defrosting — toggles + тексты (**авто: из рецептов с defrosting_instructions**)
- Freezing — toggles (**авто: из рецептов с freezing_instructions**)

**4. Cooking** (оранжевый) — 6 методов:
- Cooking Safely — toggles (**авто: список блюд с cooking_method и cooking_temp**)
- Extra Care Foods — toggles + тексты (**авто: из рецептов с extra_care_flags**)
- Reheating — toggles + тексты (**авто: из рецептов с reheating_instructions**)
- Menu Checks — тексты (**авто: ключевые блюда с методами проверки**)
- Hot Holding — toggles + текст (**авто: из рецептов с hot_holding_required**)
- Ready-to-Eat — toggles + текст (**авто: RTE-продукты из рецептов**)

**5. Management** (пурпурный) — 6 методов:
- Opening & Closing Checks — toggles + файл (**авто: из шаблонов чеклистов**)
- Suppliers — тексты + файл (**авто: из таблицы suppliers**)
- Stock Control — toggles
- Training — тексты + файл (**авто: команда из profiles + сертификаты из documents**)
- Temperature Probes — toggles + текст (**авто: из чеклиста калибровки**)
- Daily Diary — toggle + файл (**авто: из чеклистов daily**)

### 4-Week Check
- Обязательная процедура SFBB: каждые 4 недели менеджер подтверждает актуальность HACCP Pack
- Реализация через дефолтный шаблон чеклиста "4-Weekly HACCP Review" (frequency: four_weekly)
- Пункты: по одному на каждую секцию — "Cross-Contamination procedures up to date", "Cleaning up to date" и т.д.
- Баннер в HACCP Pack: "Last reviewed: {date}" / "Review overdue — due {date}"
- Уведомления: за 3 дня до срока + в день + если просрочен
- При заполнении 4-week check обновляется дата последнего ревью

### Геймификация
- XP: toggle = +10, text = +20, file = +50, select = +20
- 5 уровней: Kitchen Starter (0) → Safety Aware (100) → Hygiene Pro (300) → Compliance Expert (600) → HACCP Master (1000)
- Celebration при завершении секции на 100%
- Progress bar: X/Y tasks, Z% по каждой секции и общий

### Экспорт
- Кнопка Export → PDF со всеми заполненными данными
- Формат готовый для EHO-инспектора
- Включает: все тексты, отмеченные процедуры, приложенные документы

### Хранение
- Ручные данные (toggles, texts, overrides) хранятся в Supabase, привязаны к business_id
- Автоданные вычисляются на лету из существующих таблиц
- Поле `haccp_last_reviewed_at` в businesses — дата последнего 4-week check

### Изменения в БД для HACCP Pack
- Новые поля в recipes: `freezing_instructions` (TEXT), `defrosting_instructions` (TEXT)
- Новая таблица или JSON-поле для хранения ручных данных HACCP Pack
- Поле `haccp_last_reviewed_at` (TIMESTAMPTZ) в businesses
- 6-й дефолтный шаблон чеклиста: "4-Weekly HACCP Review"
- 10-й тип уведомления: HACCP Review overdue
