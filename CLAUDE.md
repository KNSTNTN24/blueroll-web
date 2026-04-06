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
- Supabase Access Token: `sbp_6f0448fce3704c37e58a6a20ddb167a21539bf4d`
- Stripe ключи — в Supabase secrets (Edge Functions)
- Paywall сейчас — тестовая заглушка (пишет `trialing` в БД без Stripe)

## Что сделано сегодня (6 апреля)
- v2 полная перезапись с нуля по спекам
- 30 страниц, 17 фич, билд с первой попытки
- HACCP Pack с автозаполнением и сохранением в БД
- Онбординг: 7 шагов (новый бизнес) / 5 шагов (join) + paywall
- AI импорт рецептов работает (PDF/text/photo)
- Меню/аллергены/HACCP — форматированный PDF экспорт
- Edge Functions задеплоены с --no-verify-jwt
- Новые колонки в БД: recipes.freezing_instructions, recipes.defrosting_instructions, businesses.haccp_*, таблица haccp_pack_data

## Что осталось
- Stripe: заменить тестовую заглушку на реальный Stripe flow
- Subscription gating: включить в dashboard layout когда Stripe готов
- Фото в чеклистах: upload на вебе
- Recipe edit page: проверить что работает
- Reports PDF: форматированный export (сейчас window.print)
