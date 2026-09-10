# Blueroll — матрица доступа и тесты пейволла

Составлено по коду 2026-09-03: `supabase/migrations/2026060712*`, `2026071218*`, `20260713100000`,
`supabase/functions/{stripe,play,apple}-webhook`, `src/hooks/use-auth.ts`,
`src/app/(dashboard)/layout.tsx`, `src/app/(auth)/paywall/page.tsx`,
`haccp-mobile/lib/providers/purchase_provider.dart`, `lib/config/router.dart`,
`lib/screens/auth/paywall_screen.dart`.

Документ отвечает на один вопрос: **при каком состоянии оплаты, на какой платформе и для какого
типа пользователя доступ должен быть открыт, а при каком — закрыт**, и даёт полный список тестов
на обе стороны (разрешение и запрет).

---

## 1. Три уровня гейта

Доступ проверяется трижды, разными формулами. Это источник почти всех наших багов: уровни
расходятся между собой.

| Уровень | Где | Формула | Что происходит при отказе |
|---|---|---|---|
| **L1 — арбитр** | `compute_entitlement()` + триггер `trg_zz_subscription_arbiter` | из 3 источников выбирает победителя, пишет `subscription_status` + `trial_ends_at` | статус становится `canceled` / `none` |
| **L2 — сервер (RLS)** | `is_business_entitled()` + 52 RESTRICTIVE-политики на 26 таблицах (21 с `business_id` + 5 дочерних) | `active` ИЛИ живой `trialing` ИЛИ 7-дневный grace по сырым каналам | INSERT/UPDATE запрещены; SELECT и DELETE открыты **намеренно** |
| **L3 — клиент** | веб `use-auth.ts` + `(dashboard)/layout.tsx`; мобилка `purchase_provider.dart` + `router.dart` | у веба и мобилки **разные** формулы (см. §4) | редирект на `/paywall` |

L2 — единственный уровень, который реально защищает данные. L3 — это UX, его можно обойти;
L1 — то, что оба читают.

### Источники (каналы) и кто в них пишет

| Источник | Колонки | Писатели |
|---|---|---|
| `manual` | `manual_status`, `manual_until` | `set_default_trial` (BEFORE INSERT, 14 дней), ручные гранты ops |
| `stripe` | `stripe_status`, `stripe_until` (+ `stripe_customer_id`, `subscription_id`) | `create-subscription`, `stripe-webhook`, `manage-subscription` |
| `iap` | `iap_status`, `iap_expires_at` (+ `iap_provider`, `iap_product_id`, токены) | `play-webhook`, `apple-webhook`, `record_iap_purchase` (owner-only) |

`subscription_status` и `trial_ends_at` — **вычисляемые**. Клиент (`authenticated`/`anon`) не может
писать ни в них, ни в колонки источников: триггер `trg_protect_business_entitlement` кидает
`insufficient_privilege`. Писать могут только `service_role` (вебхуки) и SECURITY DEFINER RPC.

### Правила арбитража (L1)

1. Источник **живой** ⟺ `status ∈ (active, trialing, canceling)` И (`until IS NULL` ИЛИ `until > now()`).
   `NULL until` = бессрочно.
2. Среди живых побеждает **самый поздний `until`** (`NULL` = бесконечность). Ничья → `manual > iap > stripe`.
3. `canceling` **никогда не публикуется** — выходит наружу как `active` (клиенты понимают только
   `active|trialing`; иначе платящего выкидывало бы досрочно).
4. Живых нет → `canceled`, если хоть один источник когда-либо существовал, иначе `none`;
   `trial_ends_at = max(until)`.
5. Прямые записи в вычисляемые колонки игнорируются — триггер всё пересчитывает.

### Словарь статусов по каналам

| Внешнее событие | Что пишется |
|---|---|
| Stripe `active` / `trialing` / `past_due` / `canceled` | as-is; `canceling` при cancel_at_period_end |
| Play `ACTIVE` → `active` · `IN_GRACE_PERIOD` → **`active`** · `CANCELED` → `canceling` · `EXPIRED` → `canceled` · `ON_HOLD` → `past_due` · `PAUSED` → `paused` · `PENDING` → `incomplete` |
| Apple `1` → `active` · `2` → `canceled` · `3` → `past_due` · `4` (grace) → **`active`** · `5` (revoked) → `canceled` |

⚠️ Ветка `iap_status IN ('in_grace')` в `is_business_entitled` **мертва**: ни один вебхук такого
значения не пишет. Grace у Apple и Google уже смаплен в `active`.

---

## 2. Матрица состояний одного источника — 72 кейса

Три канала × 8 статусов × 3 положения `until` = **72 состояния**. Правило одинаково для всех трёх
каналов, поэтому таблица одна; ID кейса = `ENT-<канал><статус><until>`, где канал ∈ {M, S, I},
until ∈ {N (null), F (future), P (past)}.

| Статус источника | `until` = NULL | `until` в будущем | `until` в прошлом |
|---|---|---|---|
| `active` | L1 `active` · L2 ✅ · L3 ✅ | L1 `active` · L2 ✅ · L3 ✅ | L1 `canceled` · L2 ❌ · L3 ❌ |
| `trialing` | L1 `trialing`, `trial_ends_at`=NULL · L2 ✅ · L3 ✅ | L1 `trialing` · L2 ✅ · L3 ✅ | L1 `canceled` · L2 ❌ · L3 ❌ |
| `canceling` | L1 **`active`** · L2 ✅ · L3 ✅ | L1 **`active`** · L2 ✅ · L3 ✅ | L1 `canceled` · L2 ❌ · L3 ❌ |
| `past_due` | L1 `canceled` · L2 ❌ (нет `until` → grace не считается) · L3 ❌ | L1 `canceled` · **L2 ✅ 7 дней grace** · **L3 ❌ — расхождение D1** | L1 `canceled` · L2 ✅ пока `until > now-7d`, иначе ❌ · L3 ❌ |
| `paused` | L1 `canceled` · L2 ❌ · L3 ❌ | то же | то же |
| `incomplete` | L1 `canceled` · L2 ❌ · L3 ❌ | то же | то же |
| `canceled` | L1 `canceled` · L2 ❌ · L3 ❌ | то же | то же |
| `NULL` (канала не было) | L1 `none` (если и другие пусты) · L2 ❌ · L3 ❌ | — | — |

Плюс комбинации нескольких живых источников (ENT-MULTI-01…12): побеждает поздний `until`;
`NULL` бьёт любую дату; при равенстве — `manual > iap > stripe`; протухший источник не отменяет
живого; `canceling` + `active` → `active`.

---

## 3. Типы пользователей

| Тип | Как отличается | Влияние на доступ |
|---|---|---|
| `owner` | `profiles.role = 'owner'` | видит кнопку покупки, может `record_iap_purchase`, может удалить аккаунт |
| `manager` | системная роль | доступ = доступ бизнеса; кнопки покупки нет |
| `kitchen_staff` / кастомная роль | `roles.base_tier`, capability-RBAC | то же; capability-гейты поверх, но не вместо пейволла |
| приглашённый (только что вошёл по инвайту) | `grantTeamAccess()` ставит `blueroll_team_member` в SharedPreferences | оптимистичный доступ из кэша до первой серверной проверки |
| legacy (аккаунт создан до **2026-04-11**) | `paywall_screen.dart:31` `_legacyCutoff` | на мобилке **обходит пейволл всегда**: попал на `/paywall` → `grantTeamAccess()` → `/dashboard` |
| владелец на signup-триале | `signup_trial = true`, покупки нет | L2 ✅ (иначе онбординг не смог бы сохранить точки), но мобилка показывает пейволл — **by design** |
| демо-режим | `demo_business_id()` | читает демо-данные; на пейволл не влияет |
| бизнес soft-deleted | `deleted_at IS NOT NULL` | `is_business_entitled` = false всегда, независимо от оплаты |

---

## 4. Клиентские гейты — где веб и мобилка расходятся

**Веб** (`use-auth.ts:198`):
```
isSubscribed = status === 'active' || (status === 'trialing' && trial_ends_at > now)
```
`(dashboard)/layout.tsx:34`: `!isSubscribed → /paywall`. Страница `/paywall` при `active|trialing`
уводит обратно на `/dashboard` (дату при этом не проверяет — безопасно только потому, что L1 не
публикует протухший `trialing`).

**Мобилка** (`purchase_provider.dart:600+`) задаёт **два** вопроса:
```
entitled   = status=='active' || (status=='trialing' && trial_ends_at > now)
subscribed = entitled && (живой iap_status || живой stripe_status || signup_trial == false)
```
плюс слой кэша: `SharedPreferences` даёт оптимистичный доступ мгновенно; серверный ответ
`false` — отзывает и чистит кэш; `null` (офлайн/RLS-ошибка) — **сохраняет** доступ.

### Известные расхождения (каждое = отдельный тест)

| ID | Расхождение | Последствие |
|---|---|---|
| **D1** | L2 даёт 7 дней grace при `past_due`, L3 (и веб, и мобилка) — нет | В grace-период юзер на пейволле, хотя сервер разрешает запись |
| **D2** | Мобилка требует «покупку или не-signup-триал», веб — нет | Один аккаунт: веб пускает внутрь, мобилка показывает пейволл |
| **D3** | `stripe-webhook` пишет `stripe_until = trial_end` всегда | После конверсии триал→оплата платящий мгновенно теряет доступ (Tootoomoo, дважды). **Фикс написан, НЕ задеплоен** |
| **D4** | Legacy-обход живёт в `paywall_screen`, а не в едином гейте | Любой аккаунт до 11.04.2026 бесплатен вечно; сбросить нельзя иначе как правкой кода |
| **D5** | Grace-ветка `in_grace` в `is_business_entitled` мертва | Мнимое покрытие: код читается как «grace учтён», фактически только `past_due`/`on_hold` |
| **D6** | Кэш `null` при RLS-ошибке трактуется как «офлайн» | Реальный отказ доступа выглядит для мобилки как сеть и не отзывает доступ |

---

## 5. Мультисайт

- Тариф считается по `billable_site_count(business_id)` = число точек со `status <> 'archived'`.
- Цены: 1 точка £24.99, 2 — £49.99, 3+ — £74.99 (`kTierPrice`), продукт `proProductIdFor(sites)`,
  число точек зажимается в `clamp(1,3)`.
- Stripe-quantity синхронизируется `sync-site-quantity` (фаза 2, ветки `web-integrate`/`web-multisite`,
  **в main не смёржено**).
- Пейволл сам по себе **не пер-сайтовый**: entitlement живёт на строке бизнеса, все точки
  открываются и закрываются вместе.

---

## 6. Тесты

Уровни исполнения: **SQL** — pgTAP в `supabase/tests/`; **UNIT** — Deno-тест функции вебхука или
Flutter-тест провайдера; **E2E** — живой прогон на устройстве/браузере.

### 6.1 Арбитраж — L1 (SQL)

| ID | Вход | Ожидание |
|---|---|---|
| ENT-M/S/I × 8 статусов × 3 `until` = **72** | один источник, остальные NULL | ровно строка из таблицы §2 |
| ENT-MULTI-01 | manual(active, 2027) + stripe(trialing, прошлое) | `active`, 2027 |
| ENT-MULTI-02 | iap(active, будущее) + stripe(canceled) | `active`, `iap_until` |
| ENT-MULTI-03 | stripe(active, NULL) + manual(active, будущее) | `active`, NULL (∞ бьёт дату) |
| ENT-MULTI-04 | manual(active, NULL) + iap(active, NULL) | `active`, tie-break → manual |
| ENT-MULTI-05 | iap(active, NULL) + stripe(active, NULL) | tie-break → iap |
| ENT-MULTI-06 | stripe(canceling, будущее) + iap(canceled) | `active` (не `canceling`) |
| ENT-MULTI-07 | все три протухли | `canceled`, `trial_ends_at = max(until)` |
| ENT-MULTI-08 | ни одного источника | `none`, `trial_ends_at` NULL |
| ENT-MULTI-09 | прямой `UPDATE subscription_status='trialing'` поверх живого manual | строка остаётся `active` |
| ENT-MULTI-10 | INSERT нового бизнеса | `set_default_trial` → manual trialing +14 дней, арбитр пересчитал |
| ENT-MULTI-11 | порядок триггеров | арбитр отрабатывает ПОСЛЕ `trg_set_default_trial` |
| ENT-MULTI-12 | `deleted_at` проставлен при живом manual | L1 `active`, но L2 = false |

### 6.2 Серверный гейт — L2 (SQL)

| ID | Проверка |
|---|---|
| GATE-01…21 | по каждой из 21 таблицы с `business_id`: INSERT при `entitled=false` → отказ |
| GATE-22…42 | те же 21 таблица: UPDATE при `entitled=false` → отказ |
| GATE-43…47 | 5 дочерних таблиц (`recipe_ingredients`, `recipe_tags`, `checklist_template_items`, `checklist_responses`, `delivery_photos`) — гейт через родителя |
| GATE-48 | SELECT при `entitled=false` — **разрешён** (данные видны после лапса) |
| GATE-49 | DELETE при `entitled=false` — **разрешён** |
| GATE-50 | `entitled=true` → INSERT/UPDATE проходят (позитивный контроль) |
| GATE-51 | grace: `stripe_status='past_due'`, `stripe_until = now()-6d` → запись разрешена |
| GATE-52 | grace истёк: `stripe_until = now()-8d` → запись запрещена |
| GATE-53 | grace по IAP: `iap_status='on_hold'`, `iap_expires_at = now()-6d` → разрешено |
| GATE-54 | `past_due` без `until` → запрещено |
| GATE-55 | soft-deleted бизнес при активной подписке → запрещено |
| GATE-56 | `ingredients` с `business_id IS NULL` → отказ (default-deny) |
| COL-01…06 | `authenticated` меняет `manual_*` / `stripe_*` / `iap_*` / `subscription_status` / `trial_ends_at` / `subscription_id` → `insufficient_privilege` |
| COL-07 | `service_role` те же записи → проходят |
| COL-08 | SECURITY DEFINER RPC (`setup_business`, `consume_trial`) → проходят |
| TRIAL-DEDUP-01 | второй бизнес с тем же email → триал отозван (`consume_trial`) |
| TRIAL-DEDUP-02 | первый бизнес с новым email → триал выдан |

### 6.3 Веб — L3 (E2E)

| ID | Состояние | Ожидание |
|---|---|---|
| WEB-01 | `active` | дашборд открыт |
| WEB-02 | живой `trialing` | дашборд открыт |
| WEB-03 | `trialing`, дата прошла | `/paywall` |
| WEB-04 | `canceled` | `/paywall` |
| WEB-05 | `none` | `/paywall` |
| WEB-06 | `past_due` в grace | **сейчас `/paywall`; ожидание — дашборд** (D1) |
| WEB-07 | на `/paywall` при `active` | редирект на `/dashboard` |
| WEB-08 | сотрудник (не owner) в оплаченном бизнесе | дашборд открыт, пейволла нет |
| WEB-09 | сотрудник в неоплаченном | `/paywall` |
| WEB-10 | оплата картой на `/paywall` | после успеха дашборд открывается **без перелогина** |
| WEB-11 | сессия без профиля | `/onboarding`, не `/paywall` |
| WEB-12 | soft-deleted бизнес | `/paywall`, запись запрещена |
| WEB-13 | попытка записи из devtools при `entitled=false` | RLS отказ (L2 держит, даже когда L3 обойдён) |

### 6.4 Мобилка — L3 (Flutter + E2E)

| ID | Состояние | Ожидание |
|---|---|---|
| MOB-01 | `active` + живой `iap_status` | дашборд |
| MOB-02 | `active` по Stripe (куплено на вебе) | дашборд |
| MOB-03 | живой `trialing`, `signup_trial=true`, покупки нет | **пейволл** (by design, D2) |
| MOB-04 | живой `trialing`, `signup_trial=false` | дашборд |
| MOB-05 | `canceled` | пейволл |
| MOB-06 | `past_due` в grace | сейчас пейволл; ожидание — дашборд (D1) |
| MOB-07 | холодный старт с кэшем, сервер говорит `false` | доступ отзывается, кэш чистится |
| MOB-08 | холодный старт с кэшем, сервер недоступен | доступ сохраняется (офлайн-кухня) |
| MOB-09 | свежая установка, вход в оплаченный бизнес | пейволл мелькает, затем дашборд (`refreshListenable`) |
| MOB-10 | приглашённый сотрудник сразу после инвайта | доступ по `team`-флагу |
| MOB-11 | у сотрудника отозвали членство, приложение онлайн | доступ отзывается при следующей проверке |
| MOB-12 | не-owner на пейволле | кнопки покупки нет, текст «Ask the business owner», Restore есть |
| MOB-13 | owner на пейволле | кнопка покупки с ценой своего тарифа |
| MOB-14 | Restore после переустановки | подписка восстанавливается, пейволл закрывается |
| MOB-15 | аккаунт создан до 2026-04-11 | пейволл обходится (D4) — тест фиксирует поведение, чтобы его нельзя было сломать молча |
| MOB-16 | выход из аккаунта | флаги кэша стёрты, следующий юзер начинает чисто |
| MOB-17 | Apple вернул неполный список продуктов | не продаётся чужой тариф, таймаут 30 с |

### 6.5 Кроссплатформа (E2E)

| ID | Купил на | Заходит на | Ожидание |
|---|---|---|---|
| XP-01 | веб Stripe | Android | доступ |
| XP-02 | веб Stripe | iOS | доступ |
| XP-03 | iOS IAP | веб | доступ |
| XP-04 | iOS IAP | Android | доступ |
| XP-05 | Android IAP | веб | доступ |
| XP-06 | Android IAP | iOS | доступ |
| XP-07 | никто не платил | любая платформа | пейволл везде |
| XP-08 | owner оплатил | сотрудник, другая платформа | доступ, покупать не предлагается |
| XP-09 | подписка отменена на вебе | мобилка, уже открытая | доступ снимается при следующей проверке |
| XP-10 | параллельно Stripe и IAP | обе платформы | побеждает поздний `until`, двойного списания нет |
| XP-11 | grace на одной платформе | другая платформа | поведение одинаковое (после фикса D1) |
| XP-12 | legacy-аккаунт | веб | **веб пейволлит, мобилка нет** — зафиксировать как известное расхождение |

### 6.6 Вебхуки (UNIT + E2E)

| ID | Событие | Ожидание |
|---|---|---|
| HOOK-S01 | Stripe `customer.subscription.created` (trialing) | `stripe_status='trialing'`, `stripe_until=trial_end` |
| HOOK-S02 | **конверсия триал→оплата** | `stripe_until = current_period_end`, НЕ `trial_end`; entitlement сохраняется (**D3, регресс Tootoomoo**) |
| HOOK-S03 | `current_period_end` пришёл в `items[]` (API 2025-04-30.basil) | читается из `items`, не теряется |
| HOOK-S04 | периода нет вовсе | `until = null` (fail open), доступ не отбирается |
| HOOK-S05 | `cancel_at_period_end` | `stripe_status='canceling'`, доступ до конца периода |
| HOOK-S06 | `invoice.payment_failed` | `past_due` + grace 7 дней |
| HOOK-P01…P07 | все 7 значений `SubscriptionState` Play | маппинг по §1 |
| HOOK-A01…A05 | все 5 статусов Apple | маппинг по §1 |
| HOOK-X01 | вебхук по неизвестному customer/token | 200, ничего не ломает |
| HOOK-X02 | повторная доставка того же события | идемпотентно |
| HOOK-X03 | вебхук пишет в вычисляемые колонки напрямую | игнорируется арбитром |

### 6.7 Мультисайт-биллинг

| ID | Проверка |
|---|---|
| TIER-01…03 | 1 / 2 / 3 точки → £24.99 / £49.99 / £74.99, правильный product_id |
| TIER-04 | 4+ точек → тариф 3+, `clamp(1,3)` |
| TIER-05 | архивная точка не считается в `billable_site_count` |
| TIER-06 | добавили точку при активной подписке → апгрейд без второго списания |
| TIER-07 | убрали точку → даунгрейд со следующего периода, доступ не рвётся |
| TIER-08 | все точки архивированы → тариф не падает ниже 1 |
| TIER-09 | entitlement общий: оплата открывает **все** точки бизнеса |
| TIER-10 | неоплата закрывает все точки одновременно, а не по одной |

### 6.8 Явные запреты (негативные)

| ID | Проверка |
|---|---|
| NEG-01 | неоплаченный бизнес не может создать чеклист/рецепт/документ (L2) |
| NEG-02 | неоплаченный не может изменить существующие данные |
| NEG-03 | неоплаченный **может** читать и удалять свои данные |
| NEG-04 | клиент не может выдать себе entitlement (COL-01…06) |
| NEG-05 | сотрудник не может купить подписку от имени бизнеса (`record_iap_purchase` owner-only) |
| NEG-06 | сотрудник не видит кнопку покупки на мобилке |
| NEG-07 | второй бесплатный триал на тот же email не выдаётся |
| NEG-08 | удалённый (soft-delete) бизнес не пишет ничего даже при активной подписке |
| NEG-09 | чужой `business_id` не пишется и не читается ни при каком статусе оплаты |
| NEG-10 | обход клиентского гейта (прямой вызов API) не даёт записи |
| NEG-11 | истёкший grace закрывает запись ровно на 8-й день |
| NEG-12 | `paused` / `incomplete` / `revoked` не дают доступа ни на одном уровне |

**Итого:** 84 (L1: 72 + 12) · 66 (L2: 56 GATE + 8 COL + 2 TRIAL-DEDUP) · 13 (веб) · 17 (мобилка) ·
12 (кросс) · 21 (вебхуки) · 10 (тарифы) · 12 (запреты) = **235 проверок**, из них 171
(L1 + L2 + вебхуки) автоматизируются на уровне SQL/unit, без устройств и без сторов.

---

## 7. Что делать в первую очередь

1. **HOOK-S02** — тест на конверсию триал→оплата плюс деплой уже написанного фикса
   `stripe-webhook`. Это D3, он бил по платящему клиенту дважды.
2. **GATE-49…52 + D1** — согласовать grace между L2 и L3: либо клиенты учитывают grace, либо
   сервер его убирает. Сейчас поведение противоречиво.
3. **ENT-72** — прогнать полную матрицу §2 как pgTAP: это дёшево и закрывает весь L1 разом.
4. **Сторож в проде** — ежедневный запрос «активный канал при `is_business_entitled = false`» с
   пушем в ntfy: ловит любое будущее расхождение до жалобы клиента.
