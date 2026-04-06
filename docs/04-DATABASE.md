# Blueroll Web v2 — Структуры БД и API

---

## Supabase проект

- **ID**: `rszrggreuarvodcqeqrj`
- **URL**: `https://rszrggreuarvodcqeqrj.supabase.co`
- **Storage bucket**: `documents` (private, signed URLs)

---

## Таблицы (21 активная)

### 1. businesses
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | gen_random_uuid() |
| name | TEXT NOT NULL | Название |
| address | TEXT | Адрес |
| registration_number | TEXT | Рег. номер |
| fhrs_id | INTEGER | FSA establishment ID |
| fsa_rating | TEXT | Рейтинг (0-5, Exempt, AwaitingInspection) |
| post_code | TEXT | Postcode |
| stripe_customer_id | TEXT | Stripe customer |
| subscription_id | TEXT | Stripe subscription |
| subscription_status | TEXT | trialing/active/canceled |
| trial_ends_at | TIMESTAMPTZ | Конец триала |
| haccp_last_reviewed_at | TIMESTAMPTZ | Дата последнего 4-week HACCP review |
| haccp_auto_fill | BOOLEAN | DEFAULT true — автозаполнение HACCP Pack из данных Blueroll |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

FK: нет (корневая таблица)

---

### 2. profiles
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | FK → auth.users(id) CASCADE |
| email | TEXT NOT NULL | |
| full_name | TEXT | |
| role | TEXT NOT NULL | owner/manager/chef/kitchen_staff/front_of_house |
| business_id | UUID NOT NULL | FK → businesses(id) CASCADE |
| avatar_url | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Запросы мобилки:
- SELECT: `profiles.select('*').eq('id', userId).single()`
- SELECT: `profiles.select('id').eq('business_id', bid).inFilter('role', ['owner','manager'])` — для уведомлений
- UPDATE: full_name, avatar_url
- FK hints в join: `profiles!checklist_completions_completed_by_fkey(full_name)`, `profiles(full_name)`, `profiles(full_name, email)`

---

### 3. invites
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| email | TEXT NOT NULL | |
| role | TEXT NOT NULL | |
| business_id | UUID NOT NULL | FK → businesses(id) |
| invited_by | UUID NOT NULL | FK → profiles(id) |
| token | TEXT UNIQUE | 32-char random |
| expires_at | TIMESTAMPTZ | NOW() + 7 days |
| used_at | TIMESTAMPTZ | NULL если не использован |

---

### 4. checklist_templates
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| description | TEXT | |
| frequency | TEXT NOT NULL | daily/weekly/monthly/four_weekly/custom |
| assigned_roles | TEXT[] | Массив ролей |
| business_id | UUID NOT NULL | FK → businesses(id) |
| sfbb_section | TEXT | |
| is_default | BOOLEAN | |
| active | BOOLEAN | |
| supervisor_role | TEXT | NULL = не требуется sign-off |
| deadline_time | TEXT | HH:mm формат |
| created_at | TIMESTAMPTZ | |

---

### 5. checklist_template_items
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| template_id | UUID NOT NULL | FK → checklist_templates(id) CASCADE |
| name | TEXT NOT NULL | |
| description | TEXT | |
| item_type | TEXT NOT NULL | tick/temperature/text/yes_no/photo |
| required | BOOLEAN | |
| sort_order | INT | |
| min_value | NUMERIC | Для temperature |
| max_value | NUMERIC | Для temperature |
| unit | TEXT | °C и т.д. |
| sfbb_reference | TEXT | |

---

### 6. checklist_completions
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| template_id | UUID NOT NULL | FK → checklist_templates(id) |
| completed_by | UUID NOT NULL | FK → profiles(id) |
| completed_at | TIMESTAMPTZ | DEFAULT NOW() |
| signed_off_by | UUID | FK → profiles(id) |
| signed_off_at | TIMESTAMPTZ | |
| notes | TEXT | |
| business_id | UUID NOT NULL | FK → businesses(id) |

FK hints: `profiles!checklist_completions_completed_by_fkey(full_name)`, `checklist_templates(name, supervisor_role)`, `signer:profiles!signed_off_by(full_name)`

---

### 7. checklist_responses
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| completion_id | UUID NOT NULL | FK → checklist_completions(id) CASCADE |
| item_id | UUID NOT NULL | FK → checklist_template_items(id) CASCADE |
| value | TEXT NOT NULL | Ответ |
| notes | TEXT | |
| flagged | BOOLEAN | Вне диапазона |

---

### 8. ingredients
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| allergens | TEXT[] | 14 EU аллергенов |
| business_id | UUID | NULL = глобальный |

---

### 9. recipes
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| description | TEXT | |
| category | TEXT NOT NULL | starter/main/dessert/side/sauce/drink/cocktail/beverage/other |
| instructions | TEXT | |
| cooking_method | TEXT | |
| cooking_temp | NUMERIC | |
| cooking_time | NUMERIC | |
| cooking_time_unit | TEXT | minutes/hours |
| sfbb_check_method | TEXT | |
| extra_care_flags | TEXT[] | |
| reheating_instructions | TEXT | |
| hot_holding_required | BOOLEAN | |
| chilling_method | TEXT | |
| freezing_instructions | TEXT | Как замораживать (для HACCP Pack → Chilling → Freezing) |
| defrosting_instructions | TEXT | Как размораживать (для HACCP Pack → Chilling → Defrosting) |
| photo_url | TEXT | |
| source_video_url | TEXT | |
| business_id | UUID NOT NULL | FK → businesses(id) |
| created_by | UUID NOT NULL | FK → profiles(id) |
| active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

---

### 10. recipe_ingredients
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| recipe_id | UUID NOT NULL | FK → recipes(id) CASCADE |
| ingredient_id | UUID NOT NULL | FK → ingredients(id) CASCADE |
| quantity | TEXT | |
| unit | TEXT | |

---

### 11. menu_items
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| recipe_id | UUID NOT NULL | FK → recipes(id) CASCADE |
| category | TEXT NOT NULL | |
| active | BOOLEAN | |
| display_order | INT | |
| business_id | UUID NOT NULL | FK → businesses(id) |

**Примечание**: В вебе НЕ используется для отображения меню. Меню = активные рецепты.

---

### 12. diary_entries
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| date | DATE NOT NULL | |
| business_id | UUID NOT NULL | FK → businesses(id) |
| signed_by | UUID | FK → profiles(id) |
| notes | TEXT | |
| opening_done | BOOLEAN | deprecated |
| closing_done | BOOLEAN | deprecated |
| created_at | TIMESTAMPTZ | |
| UNIQUE(date, business_id) | | |

---

### 13. notifications
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_id | UUID NOT NULL | FK → profiles(id) CASCADE |
| type | TEXT NOT NULL | checkin/incident/checklist/document/team |
| title | TEXT NOT NULL | |
| message | TEXT NOT NULL | |
| read | BOOLEAN | DEFAULT false |
| link | TEXT | Навигация |
| created_at | TIMESTAMPTZ | |

---

### 14. suppliers
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| contact_name | TEXT | |
| phone | TEXT | |
| address | TEXT | |
| goods_supplied | TEXT | |
| delivery_days | TEXT[] | |
| business_id | UUID NOT NULL | FK → businesses(id) |
| created_at | TIMESTAMPTZ | |

---

### 15. incidents
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| type | TEXT NOT NULL | complaint/incident |
| description | TEXT NOT NULL | |
| action_taken | TEXT | |
| follow_up | TEXT | |
| reported_by | UUID NOT NULL | FK → profiles(id) |
| date | DATE NOT NULL | |
| business_id | UUID NOT NULL | FK → businesses(id) |
| status | TEXT | DEFAULT 'open' |
| resolved_by | UUID | FK → profiles(id) |
| resolved_at | TIMESTAMPTZ | |
| resolved_notes | TEXT | |
| updated_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

---

### 16. documents
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| title | TEXT NOT NULL | |
| description | TEXT | |
| category | TEXT NOT NULL | certificate/license/policy/instruction/contract/inspection/training/other |
| file_url | TEXT NOT NULL | Storage path |
| file_name | TEXT NOT NULL | |
| file_size | BIGINT | |
| file_type | TEXT | MIME |
| uploaded_by | UUID NOT NULL | FK → profiles(id) CASCADE |
| business_id | UUID NOT NULL | FK → businesses(id) CASCADE |
| access_level | TEXT NOT NULL | all/managers_only/owner_only/custom |
| expires_at | DATE | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

---

### 17. document_access
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| document_id | UUID NOT NULL | FK → documents(id) CASCADE |
| profile_id | UUID NOT NULL | FK → profiles(id) CASCADE |
| granted_by | UUID NOT NULL | FK → profiles(id) |
| created_at | TIMESTAMPTZ | |
| UNIQUE(document_id, profile_id) | | |

---

### 18. staff_checkins
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| user_id | UUID NOT NULL | FK → profiles(id) CASCADE |
| business_id | UUID NOT NULL | FK → businesses(id) CASCADE |
| checked_in_at | TIMESTAMPTZ | DEFAULT NOW() |
| checked_out_at | TIMESTAMPTZ | NULL = on-site |
| date | DATE | DEFAULT CURRENT_DATE |
| mood | TEXT | Emoji |
| created_at | TIMESTAMPTZ | |

FK hint: `profiles!staff_checkins_user_id_fkey(full_name, avatar_url, role)`

---

### 19. deliveries
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| supplier_id | UUID | FK → suppliers(id) SET NULL |
| received_by | UUID | FK → profiles(id) SET NULL |
| received_at | TIMESTAMPTZ | |
| product_temperature | NUMERIC | |
| notes | TEXT | |
| business_id | UUID NOT NULL | FK → businesses(id) CASCADE |
| created_at | TIMESTAMPTZ | |

FK hints: `suppliers(name)`, `profiles(full_name)`, `delivery_photos(*)`

---

### 20. delivery_photos
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | |
| delivery_id | UUID NOT NULL | FK → deliveries(id) CASCADE |
| photo_url | TEXT NOT NULL | |
| file_name | TEXT | |
| created_at | TIMESTAMPTZ | |

---

### 21. haccp_pack_data
| Колонка | Тип | Описание |
|---------|-----|----------|
| id | UUID PK | gen_random_uuid() |
| business_id | UUID NOT NULL UNIQUE | FK → businesses(id) CASCADE |
| data | JSONB NOT NULL | Все ручные данные: toggles, texts, file refs, selects, overrides |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**Одна строка на бизнес.** Структура `data` JSONB:
```json
{
  "toggles": { "personal-hygiene-0": true, "cloths-1": false, ... },
  "texts": { "personal-hygiene-work-clothes": "White chef jacket...", ... },
  "files": { "pest-control-pest-contract": "filename.pdf", ... },
  "selects": { "chilled-storage-fridge-method": "Digital display", ... },
  "overrides": { "separating-foods-delivery-times": "custom text overriding auto" }
}
```

- `toggles` — key = `{methodId}-{toggleIndex}`, value = boolean
- `texts` — key = `{methodId}-{textKey}`, value = string
- `files` — key = `{methodId}-{fileKey}`, value = filename (файл хранится в Storage)
- `selects` — key = `{methodId}-{selectKey}`, value = string
- `overrides` — key совпадает с auto-полем, если set → приоритет над авто

Запросы:
- SELECT: `.select('*').eq('business_id', bid).single()` — загрузка всего пака
- UPSERT: `.upsert({ business_id, data, updated_at })` — сохранение при каждом изменении

---

## RPC функции (SECURITY DEFINER)

### setup_business
```
setup_business(
  business_name TEXT,
  owner_name TEXT,
  business_address TEXT DEFAULT NULL,
  p_fhrs_id INTEGER DEFAULT NULL,
  p_fsa_rating TEXT DEFAULT NULL,
  p_post_code TEXT DEFAULT NULL
) → void
```
Создаёт бизнес + профиль owner. Обходит RLS.

### join_with_invite
```
join_with_invite(
  invite_token TEXT,
  member_name TEXT
) → void
```
Находит инвайт по токену, создаёт профиль с ролью из инвайта, помечает used_at.

### get_my_business_id / get_my_role
Хелперы для RLS-политик. Не вызываются из приложения напрямую.

---

## Edge Functions

### import-recipe
- **POST**: `{ text?, pdf_base64?, image_base64?, image_mime?, filename? }`
- **Возвращает**: `{ name, description, category, instructions, cookingMethod, cookingTemp, cookingTime, cookingTimeUnit, chillingMethod, freezingInstructions, defrostingInstructions, reheatingInstructions, hotHoldingRequired, extraCareFlags[], ingredients[{name, quantity, unit, allergens[]}] }`
- **Модель**: Claude Sonnet
- **Env**: `ANTHROPIC_API_KEY`

### create-subscription
- **POST**: `{ userId, email, businessId }`
- **Возвращает**: `{ checkoutUrl }`
- **Логика**: создаёт Stripe customer + Checkout Session (14-day trial)
- **Env**: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`

### delete-account
- **POST**: `{ userId, businessId }`
- **Логика**: каскадное удаление всех данных бизнеса + auth user (включая haccp_pack_data)
- **Env**: `SUPABASE_SERVICE_ROLE_KEY`

### capture-lead
- **POST**: `{ email, source }`
- **Логика**: сохраняет лид, отправляет email через Resend
- Не используется веб-приложением

---

## Storage

### Bucket: `documents` (private)
- **Path**: `{businessId}/{timestamp}_{fileName}`
- **Upload**: `supabase.storage.from('documents').upload(path, file)`
- **Download**: `supabase.storage.from('documents').createSignedUrl(path, 3600)` — signed URL на 1 час
- **Delete**: `supabase.storage.from('documents').remove([path])`
- **Также используется для**: файлов HACCP Pack (сертификаты, расписания) — path: `{businessId}/haccp/{methodId}_{fileKey}_{fileName}`

---

## Ключи, нужные для веб-приложения

| Ключ | Где используется | Где хранить |
|------|-----------------|-------------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase client | .env.local + Vercel |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase client | .env.local + Vercel |
| ANTHROPIC_API_KEY | Edge Function import-recipe | Supabase secrets (уже настроен) |
| STRIPE_SECRET_KEY | Edge Function create-subscription | Supabase secrets (уже настроен) |
| STRIPE_PRICE_ID | Edge Function create-subscription | Supabase secrets (уже настроен) |
| SUPABASE_SERVICE_ROLE_KEY | Edge Functions (delete-account) | Supabase secrets (уже настроен) |

**Для веб-клиента нужны только 2 ключа**: SUPABASE_URL и ANON_KEY. Остальные — на стороне Edge Functions.
