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
