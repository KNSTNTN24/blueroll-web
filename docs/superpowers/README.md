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
