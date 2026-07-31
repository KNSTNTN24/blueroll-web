@AGENTS.md

# Blueroll Web — рабочие заметки

## Рабочая версия
- **v2 (текущая)** — порт 3001, ветка `main` (замержена из `v2`)
- **v1 (старая)** — порт 3002, worktree в `/tmp/blueroll-v1` (коммит `ccbab71`)
- **Production**: https://app.blueroll.app — v2

## Запуск
```bash
npm run dev          # порт 3001 — рабочая версия v2
```

## Спецификации
- `docs/01-DESIGN.md` — дизайн, цвета, типографика, компоненты
- `docs/02-FEATURES.md` — 17 фич с описанием
- `docs/03-ONBOARDING.md` — онбординг сценарии, edge cases
- `docs/04-DATABASE.md` — 21 таблица, RPC, Edge Functions, storage

## Ключи
- Supabase URL и Anon Key — в `.env.local`
- Supabase Access Token: `sbp_…`
- Stripe ключи — в Supabase secrets (Edge Functions)
- Paywall сейчас — тестовая заглушка (пишет `trialing` в БД без Stripe)

## Что сделано (6 апреля — v2 launch)
- v2 полная перезапись с нуля по спекам
- 30 страниц, 17 фич, билд с первой попытки
- HACCP Pack с автозаполнением и сохранением в БД
- Онбординг: 7 шагов (новый бизнес) / 5 шагов (join) + paywall
- AI импорт рецептов работает (PDF/text/photo)
- Меню/аллергены/HACCP — форматированный PDF экспорт
- Edge Functions задеплоены с --no-verify-jwt

## Что сделано (9–11 апреля — PR #2, #3, #4)

### Баги колонок (фронт ↔ БД mismatch)
- suppliers: `goods` → `goods_supplied`
- deliveries: `delivered_at` → `received_at`
- incidents: `incident_date` → `date`
- documents: `file_path` → `file_url` + добавлен `file_type`
- checklist_responses: убрали `photo_url`, фото в `value` (как в мобилке)
- haccp-pack recipes query: убрали несуществующие `allergens`/`ingredients` (был сломан весь auto-fill)
- reports query: `checklist_items` → `checklist_template_items`

### Новые фичи
- **Documents preview**: inline-просмотр PDF/images через signed URL + Download
- **HACCP methods на рецептах**: `recipes.haccp_methods TEXT[]`, 9 методов (4 Chilling + 5 Cooking), мультиселект на new/edit/import, чипы на detail. Общий файл `lib/haccp-methods.ts`
- **HACCP Pack auto-fill переписан**: фильтрация по `haccp_methods` вместо парсинга текста. Ингредиенты из `recipe_ingredients → ingredients` для `sf_raw_products` и `fa_allergens_list`
- **HACCP Pack document attachments**: `DocumentPickerModal` — выбор из библиотеки или загрузка нового (полная форма как в /documents/upload). 7 file-полей
- **Reports PDF export**: Detailed + Table режимы. Table = сводная матрица (строки=пункты, столбцы=даты)
- **AI checklist generation**: Edge Function `ai-generate-checklist` + 4-step wizard (тип/оборудование/команда/заметки). Промпт с FSA SFBB правилами, тип-специфичные ограничения
- **Equipment в бизнес-профиле**: `businesses.equipment TEXT[]`, редактирование в Settings, предзаполнение wizard
- **Team invites**: 6-значные числовые коды вместо 32-символьных

### БД оптимизации (накачены в Supabase)
- RLS функции: `get_my_business_id()`, `get_my_role()` — SECURITY DEFINER + SET search_path
- Удалены 3 дублирующиеся INSERT-политики
- Индексы: `idx_documents_business`, `idx_recipe_ingredients_ingredient`
- Колонки: `recipes.haccp_methods TEXT[]`, `businesses.equipment TEXT[]`

### Onboarding race condition fix
- `loadProfileAndBusiness`: 5 ретраев, 500ms backoff, ретрай при null business_id
- Dashboard layout ждёт business, редирект на onboarding если business_id null
- Переход на dashboard через `window.location.href` (полная перезагрузка)

### Cache invalidation
- checklists/new, checklists/edit, deliveries/new, documents/upload, recipes/new, recipes/edit — все инвалидируют нужные query keys

### Stripe fix
- `loadStripe()` не вызывается с пустым ключом (conditional init)

### Filename sanitization
- Documents upload: спецсимволы в именах файлов заменяются на `_` (фикс "Invalid key")

## Git workflow
- Ветки `KNS/*` → PR → squash merge в main → `vercel --prod`
- Мария работает в своих ветках
- Edge Functions деплоятся: `SUPABASE_ACCESS_TOKEN=... supabase functions deploy <name> --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`

## Что сделано (11–12 апреля — PR #4 + Letter Tool)

### PR #4 (merged → deployed)
- **Reports PDF**: fix query (`checklist_items` → `checklist_template_items`), Detailed + Table режимы
- **AI Checklist Wizard**: 4-step wizard (тип/оборудование/команда/заметки) вместо free-text prompt
- **Edge Function `ai-generate-checklist`**: тип-специфичные FSA SFBB правила (Cleaning = no temps, Temp Log = only temps)
- **Equipment в бизнес-профиле**: `businesses.equipment TEXT[]`, Settings UI, предзаполнение wizard
- **Cache invalidation**: checklists/new+edit, deliveries/new, documents/upload
- **Constants**: `CHECKLIST_TYPES`, `DEFAULT_EQUIPMENT`

### Letter Tool (`/Users/knstntn/HACCP/letter-tool.html`)
- **Опубликован**: https://blueroll.app/letter-tool.html (GitHub Pages, mariaiontseva/blueroll-landing)
- **AI поиск**: промпт → Claude пишет SQL WHERE напрямую (полная схема 25+ колонок), `/api/ai-search`
- **AI refine**: локальная фильтрация загруженных данных через Claude JS filter/sort, `/api/ai-refine`
- **Сохранение промптов**: промпты + SQL сохраняются в localStorage, dropdown для повторного использования без AI. Удаление по одному.
- **Таблица результатов**: Name, Type (FSA), Rating (цветные бейджи), Postcode, Authority, Inspected (дата), Status, Sent (чекбокс → пишет в CRM)
- **Генерация писем**: QR код (формат `r.html?name=...&rating=...&fhrsid=...&h=...&s=...&m=...`), рейтинг-специфичный текст (5=congrats, 4=close to perfect, 0-3=challenging), зелёная плашка Food Hygiene Rating с print-color-adjust
- **Печать**: A4 portrait, margin 15/15/10/18mm, QR 33mm, font 13px, page-break per letter, логотип Blueroll (app_icon.png)
- **Mark as Sent**: чекбокс в таблице → POST `/api/contact` channel='paper' → запись в CRM
- **Report**: сводка по рейтингам и посткодам, copy to clipboard
- **CRM защита**: blocklist SQL keywords (DROP, DELETE, UPDATE и т.д.)

### Letter Tracker (`/Users/knstntn/HACCP/letter-tracker.html`)
- **Опубликован**: https://blueroll.app/letter-tracker.html
- **QR scan tracking**: каждый визит на r.html с fhrsid → fetch к `/api/business/{id}/public` → запись в `page_views`
- **Данные трекинга**: IP, город/страна (геолокация через ip-api.com), device_type, OS, browser, language, user-agent, referer
- **DB**: таблица `page_views` (fhrs_id, viewed_at, ip, city, country, region, lat, lon, device_type, os, browser, language)
- **Dashboard**: summary карточки (Letters Sent, Total Scans, Unique Visitors, Response Rate)
- **Channel filter**: 📬 Paper / 📧 Email / All — фильтрация по типу отправки
- **Таблица**: Name, Rating, Postcode, Channel, Sent, Views, Unique, Last Viewed, Status (No scans / Viewed / Viewed today)
- **Detail modal**: клик по строке → полная история сканов с IP, городом, устройством, ОС, браузером, языком
- **Recent Scans feed**: лента последних 100 сканов с геоданными
- **Breakdown**: Device Type, Top Cities, OS
- **Auto-refresh**: каждые 60 секунд (toggle)
- **Period filter**: 7d / 14d / 30d / 90d

### r.html (blueroll.app/r.html)
- Мариина версия (откат к коммиту 39e4160)
- Показывает FSA rating breakdown из URL параметров
- **Добавлен tracking pixel**: fetch к `/api/business/{fhrsid}/public` при каждом визите с fhrsid
- **Убран tawk.to чатбот**

### CRM API расширения (`blueroll-crm/app.py` на Railway)
- `/api/ai-search` POST — Claude пишет SQL WHERE или принимает сохранённый SQL (`{sql: {...}}`)
- `/api/ai-refine` POST — Claude возвращает JS filter/sort expressions
- `/api/business/{fhrs_id}/public` GET — публичные данные + запись page view с геолокацией
- `/api/page-views/stats` GET — агрегированная статистика (по channel: paper/email/all)
- `/api/page-views/{fhrs_id}` GET — детальная история сканов одного бизнеса
- `/api/business/{fhrs_id}/claim` POST — claim flow (не используется, edit token убран)
- `/api/business/{fhrs_id}/verify` GET — verify token
- `/api/business/{fhrs_id}/edit` POST — edit links
- `/api/run-migrations` POST — ручной запуск миграций
- `/api/contact` POST — теперь генерит edit_token + возвращает tokens в response
- **DB миграции**: page_views таблица, owner_email/edit_token/claimed_at/custom_links на businesses
- `ANTHROPIC_API_KEY` в Railway env vars (shared variable → web service)

### Mobile (Google Play)
- Сборка 1.3.1+10 для Google Play: fix `selectedUsEstablishmentProvider`, Gradle config (compileSdk=36, targetSdk=35, NDK 27, AGP 8.9.3, versionCode из Flutter)
- Internal Testing release загружена, 12219 устройств поддерживается

## Что сделано (31 июля — Per-site menu categories, PR #20)

Меню-категории (секции меню) стали **пер-точечными и настраиваемыми**; `category` убран из рецептов — рецепты теперь только по тэгам.

### Миграция (НАКАЧЕНА в прод 31.07 через Management API)
- Таблица `menu_categories` (id, business_id, site_id, name, sort_order, created_at); уникальный индекс `(site_id, lower(name))`, индекс `(business_id, site_id, sort_order)`; RLS: members read / managers (`has_capability('manage_recipes')`) write.
- Колонка `menu_items.site_categories jsonb default '{}'` — карта `{ "<site_id>": "<menu_category id>" }`.
- Backfill: по каждой (business, site) создал категории из легаси `catLabel(category)` в порядке DISH_CATS, проставил `site_categories[site]`. Прод: 45 категорий (9 точек × 5), 23/23 блюда привязаны, 0 без категории.
- Легаси `menu_items.category` и `recipes.category` КОЛОНКИ оставлены (дефолт, не читаются UI).

### Веб (`src/app/(dashboard)/menu/page.tsx` + `src/lib/menu-categories.ts` + `dishes.ts`)
- Группировка меню точки по её `menu_categories` (+ хвост «Uncategorised»), фильтр-пилюли = секции точки. All-sites overview остался на легаси `catLabel` (coarse, read-only).
- **AddDishDrawer**: пикер секции для точки + «＋ New section» (type-create строки `menu_categories`); пишет `site_categories[activeSite]`. Recipe-backed дедуп-мерж спредит существующую карту (без клоббера других точек).
- **Sections editor** («Menu sections»): add / rename / reorder (`sort_order`) / delete. Delete снимает секцию только у активной точки → блюда в Uncategorised.
- **Инлайн-смена секции** у блюда: дропдаун в строке (site-view) → переносит блюдо, пишет `site_categories[activeSite]`.
- **«On menu» бейдж** в пикере рецептов: рецепты, уже в меню этой точки, помечены и приглушены (кликабельны — мержат).
- CSV/PDF экспорт группируется по пер-точечным секциям.
- **Recipes → New**: поле Category убрано (только тэги).

### Осталось (Phase 2)
- Мобилка: зеркалить пер-точечные категории (модель `MenuCategory` + `menuCategoriesProvider`, группировка меню, пикер секции, sections editor, убрать category из `recipe_new_v2.dart` + показать тэги на карточке). Едет вместе со всей Kitchen.
- Веб фоллоу-апы (некритич.): общий `setSection.isPending` дизейблит все дропдауны разом; нет юнит-теста на merge/drop-логику; select без aria-label; setSection без success-тоста.

## Ключевые URL и сервисы
- **Web app**: https://app.blueroll.app (Vercel, repo: KNSTNTN24/blueroll-web)
- **CRM API**: https://web-production-54cc.up.railway.app (Railway, repo: KNSTNTN24/blueroll-crm)
- **Landing + tools**: https://blueroll.app (GitHub Pages, repo: mariaiontseva/blueroll-landing)
- **Letter Tool**: https://blueroll.app/letter-tool.html
- **Letter Tracker**: https://blueroll.app/letter-tracker.html
- **FSA Outreach**: https://blueroll.app/fsa.html
- **Mobile**: KNSTNTN24/haccp-mobile (Flutter, App Store + Google Play)
- **Supabase**: project `rszrggreuarvodcqeqrj`

## Git workflow
- Ветки `KNS/*` → PR → squash merge в main → `vercel --prod`
- Мария работает в своих ветках
- Edge Functions деплоятся: `SUPABASE_ACCESS_TOKEN=... supabase functions deploy <name> --project-ref rszrggreuarvodcqeqrj --no-verify-jwt`
- CRM деплоится через git push в main (Railway auto-deploy)
- Landing деплоится через git push в gh-pages (GitHub Pages)

## Локальные файлы (не в git, на машине)
- `/Users/knstntn/HACCP/letter-tool.html` — мастер-копия letter tool (деплоится в blueroll-landing)
- `/Users/knstntn/HACCP/letter-tracker.html` — мастер-копия tracker (деплоится в blueroll-landing)
- `/Users/knstntn/HACCP/fsa_outreach_tool.html` — копия fsa.html для справки
- Деплой landing: `cp file.html /tmp/blueroll-landing/ && cd /tmp/blueroll-landing && git add . && git commit && git push origin gh-pages`
- Локальный сервер для тестов: `cd /Users/knstntn/HACCP && python3 -m http.server 8888`

## Что осталось
- Stripe: заменить тестовую заглушку на реальный Stripe flow
- Subscription gating: включить в dashboard layout когда Stripe готов
- AI auto-fill для HACCP Pack текстовых полей (Smart button per field)
- AI chat widget (upgrade от smart buttons)
- Vercel Git integration (auto-deploy on push to main)
- Supabase Access Token: ротировать (текущий засветился в чате)
- Linktree для ресторанов: откачен, нужно переделать подход (без claim, интеграция с инстой)
