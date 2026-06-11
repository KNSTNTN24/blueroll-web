# Ops notes

## Subscription arbitration (2026-06-07)

- `businesses.subscription_status` / `trial_ends_at` — ВЫЧИСЛЯЕМЫЕ, пишет только триггер
  `trg_zz_subscription_arbiter` (см. specs/2026-06-07-subscription-arbitration-design.md).
- Ручной грант: `UPDATE businesses SET manual_status='active', manual_until='<date>' WHERE id='…';`
  Прямые записи в subscription_status игнорируются триггером (в postgres-логах будет WARNING).
- Источники: manual_status/manual_until, stripe_status/stripe_until, iap_status (+iap_expires_at как until).
  Доступ = лучший живой источник; 'canceling' публикуется как 'active'.
- Reconcile после деплоев вебхуков:
  `SELECT id FROM businesses WHERE iap_provider IS NOT NULL AND iap_status IS NULL;`
- SQL-тесты: `scripts/sql-api.sh supabase/tests/sql/<file>.sql` (01 unit, 02 trigger, 03 live regression).

## ntfy notifier (2026-06-07, fix)

- `trg_ntfy_subscription_change` снова ВКЛЮЧЁН: AFTER UPDATE (без OF!),
  WHEN по фактическому изменению subscription_status; email владельца — из profiles.
- ⚠️ Перед bulk-ресинком (`UPDATE businesses SET updated_at = updated_at`) —
  отключить: `ALTER TABLE businesses DISABLE TRIGGER trg_ntfy_subscription_change;`
  (иначе пуш на каждую изменившуюся строку), после — ENABLE.
- Тесты 02/04 при прогоне шлют по одному реальному пушу с пометкой "__…TEST__ (ignore push)".

## v-next Phase 1 — DB (2026-06-07)

- recipes: `*_override` boolean NULL=auto (vegan/vegetarian/gluten_free/dairy_free);
  effective = override ?? computed-from-allergens.
- checklist_templates: `multi_per_day` (bool), `min_per_day` (int ≥0, 0 = optional).
- `checklist_drafts` — личные черновики (RLS: только автор), уникальность (template_id, created_by);
  клиент апсертит `ON CONFLICT (template_id, created_by)`.
- RPC `create_recipe_with_ingredients(jsonb)` — атомарное сохранение рецепта
  (рецепт + find-or-create ингредиентов + связи); клиенты переходят на него в фазах 2–3.
- recipes.category CHECK: только lowercase ('starter','main','dessert','side','sauce','drink','other').
- Тесты: supabase/tests/sql/05–08.

## v-next Phase 2 — Web (2026-06-07)

- `src/lib/dietary.ts` — единый расчёт дието-флагов (override ?? computed); чипы-редактор `src/components/dietary-chips.tsx`.
- `src/lib/checklist-status.ts` — статус/сортировка карточек (overdue, multi N/M today).
- `src/lib/initials.ts` + тип поля `initials` (валидация A-Z0-9 2-5, localStorage `blueroll_last_initials`).
- AI-импорт рецептов и веб — через RPC `create_recipe_with_ingredients`.
- Юнит-тесты: `npm test` (vitest, src/lib/*.test.ts).
- Деплой: PR → squash merge в main → `vercel --prod`.

## Security: service_role key removed from mobile (2026-06-07)

- Был зашит `service_role` JWT в haccp-mobile (checklists_screen + checklist_detail) — обход RLS.
- Причина закрыта: SELECT-политика completions уже business-scoped (admin-fetch был лишним);
  добавлена DELETE-политика `Delete own or managed completions` (responses каскадят по FK).
- Ключ удалён из обоих файлов (grep service_role = 0); будущие сборки его не отгружают.
- Ключ НЕ ротирован (решение Константина: репо приватный, риск принят). При смене решения —
  Settings→API→roll + обновить env: Edge Functions, Railway CRM, scripts/sql-api.sh.
- Тест: supabase/tests/sql/09_completion_delete_policy.test.sql.

## Recipe tags — DB (2026-06-11)

- `tags(business_id, name, name_norm GENERATED, uniq(business_id,name_norm))` +
  `recipe_tags(recipe_id, tag_id)`; RLS: читают все члены бизнеса, пишут owner/manager/chef.
- RPC `attach_tag(recipe_id, name)` — SECURITY INVOKER, normalise + find-or-create
  + link (ON CONFLICT race-safe). Detach = обычный DELETE из recipe_tags.
- Теги-сироты самоудаляются (`trg_cleanup_orphan_tag` AFTER DELETE ON recipe_tags,
  lock-then-recheck против гонок attach/detach).
- `create_recipe_with_ingredients` принимает опциональный `tags[]` (невалидные
  имена тихо скипает с RAISE WARNING — bulk-импорт не падает из-за одного тега).
- Правило имени тега (1–40 символов после btrim) живёт в ТРЁХ местах: CHECK на
  tags, attach_tag, цикл в create_recipe_with_ingredients — менять синхронно.
- Бэкфилл: категории → теги с человеческими лейблами ("Mains"), 'other' пропущен.
  82 связи / 14 тегов / 4 бизнеса на 2026-06-11.
- **`recipes.category` НЕ дропнута** (старые мобильные билды крашатся без неё) —
  `DEFAULT 'other'`, новый код её игнорирует; дроп отдельной миграцией после
  раскатки мобильного релиза с тегами.
- **Drop-миграция (будущая) ОБЯЗАНА:** (a) повторно прогнать оба INSERT'а бэкфилла
  из 20260611120300 (рецепты, созданные старыми билдами в переходный период,
  имеют category без тега); (b) ASSERT, что нет немаппированных значений category;
  (c) удалить тест 13.
- Тесты: supabase/tests/sql/10–12 — постоянная регрессия; **13 — point-in-time
  acceptance бэкфилла** (завязан на живые данные: рассинхронизируется, как только
  юзеры начнут снимать бэкфилл-теги или старые билды создадут рецепты с category;
  тогда удалить, в вечный sweep не включать).
