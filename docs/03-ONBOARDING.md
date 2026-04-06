# Blueroll Web v2 — Онбординг

---

## Два основных сценария

### Сценарий A: Новый бизнес (6 шагов)
Пользователь создаёт аккаунт и регистрирует свой ресторан.

### Сценарий B: Присоединение к команде (4 шага)
Пользователь создаёт аккаунт и присоединяется к существующему бизнесу по инвайт-коду.

---

## Сценарий A: Новый бизнес

### Шаг 1 — Имя
- Заголовок: "First, tell us your name"
- Подзаголовок: "This is how you'll appear to your team"
- Поле: "Your name" (autocapitalize words)
- Кнопка "Continue" появляется когда имя заполнено
- Внизу: "Already have an account? Sign in" → /login
- Прогресс-бар: 1/6

### Шаг 2 — Выбор сценария
- Заголовок: "Hey {firstName}" + "What brings you here?"
- Два варианта:
  - **"Setting up a business"** (иконка Store) → подпись "I'm starting fresh" → переход к шагу 3
  - **"Joining a team"** (иконка Users) → подпись "I have an invite code" → переключается на Сценарий B, шаг 3
- Кнопка "Back" → шаг 1
- Прогресс-бар: 2/6

### Шаг 3 — Поиск по postcode
- Заголовок: "Find your business"
- Подзаголовок: "Enter your postcode to find your FSA food hygiene rating"
- Поле с иконкой MapPin + кнопка поиска
- API: `https://api.ratings.food.gov.uk/Establishments?address={postcode}&pageSize=20&sortOptionKey=distance`
- Ссылка "Skip — I'll set up manually" → прыгает на шаг 6 (регистрация)
- Кнопка "Back" → шаг 2
- Прогресс-бар: 3/6

### Шаг 4 — Выбор бизнеса из результатов
- Заголовок: "Select your business"
- Подзаголовок: "{N} businesses found near {postcode}"
- Список карточек: название, адрес, рейтинг/5
- Клик по карточке → setSelected + переход к шагу 5
- Если 0 результатов: "No businesses found." + кнопка "Set up manually" → шаг 6
- Кнопка "Back" → шаг 3
- Прогресс-бар: 4/6

### Шаг 5 — Показ рейтинга FSA
- Название бизнеса сверху
- Большой квадрат с цифрой рейтинга (цвет: зелёный 4-5, жёлтый 3, красный 0-2)
- Подпись: "Food Hygiene Rating"
- Breakdown по категориям (Hygiene, Structural, Confidence in Management) — progress bars
- Кнопка "Continue" → шаг 6
- Кнопка "Back" → шаг 4
- Прогресс-бар: 5/6

### Шаг 6 — Регистрация
- Заголовок: "Almost there"
- Подзаголовок: "Setting up {businessName}" (или "Create your account to get started" если skip)
- Поля: email, пароль, подтверждение пароля
- Кнопка "Sign up"
- Внизу: "Already have an account? Sign in" → /login
- Кнопка "Back" → шаг 5 (или шаг 3 если skip)
- Прогресс-бар: 6/6

**При нажатии "Sign up":**
1. `supabase.auth.signUp(email, password)`
2. Если ошибка "already registered" → показать ошибку
3. `supabase.rpc('setup_business', { business_name, owner_name, business_address, fhrs_id, fsa_rating, post_code })`
4. Засеять 5 дефолтных чеклистов для нового бизнеса
5. `window.location.href = '/dashboard'` (полный reload)

---

## Сценарий B: Присоединение к команде

### Шаг 1 — Имя
Идентичен Сценарию A, шаг 1.
Прогресс-бар: 1/4

### Шаг 2 — Выбор сценария
Идентичен Сценарию A, шаг 2. Пользователь выбирает "Joining a team".
Прогресс-бар: 2/4

### Шаг 3 — Ввод инвайт-кода
- Заголовок: "Enter your invite code"
- Подзаголовок: "Your manager can create one in Team → Invite"
- Поле: monospace, centered, **БЕЗ преобразования регистра** (case-sensitive!)
- Кнопка "Continue" появляется когда код заполнен
- Кнопка "Back" → шаг 2
- Прогресс-бар: 3/4

### Шаг 4 — Регистрация
- Заголовок: "Almost there"
- Подзаголовок: "Create your account to join the team"
- Поля: email, пароль, подтверждение пароля
- Кнопка "Sign up"
- Прогресс-бар: 4/4

**При нажатии "Sign up":**
1. `supabase.auth.signUp(email, password)`
2. Если ошибка "already registered" → показать ошибку
3. `supabase.rpc('join_with_invite', { invite_token, member_name })`
4. Если ошибка → "Invalid or expired invite token. Ask your manager for a new one."
5. `window.location.href = '/dashboard'` (полный reload)

---

## Edge Cases

### Пользователь уже залогинен и попадает на /onboarding
- Проверяется сессия: если есть user + profile → редирект на /dashboard
- Если есть user, но нет profile → показать онбординг (пользователь зарегался но не завершил setup)
- Таймаут 3 секунды на проверку → если не ответило, показать онбординг

### Пользователь уже залогинен и попадает на /login
- Проверяется сессия: если есть user + profile → редирект на /dashboard

### Страница "Setting up your account..."
- Показывается после signup пока проверяется сессия
- Текст: "Setting up your account... You'll be redirected to the dashboard automatically."
- Ссылка: "If the page doesn't load within a few seconds, click here" → /dashboard

### Supabase email confirmation
- **Email confirmation ОТКЛЮЧЕН** в Supabase проекте
- signUp сразу создаёт сессию без подтверждения email

### Инвайт-код просрочен
- Токен в таблице invites имеет expires_at (7 дней)
- RPC `join_with_invite` проверяет срок → возвращает ошибку
- Показываем: "Invalid or expired invite token. Ask your manager for a new one."

### Инвайт-код уже использован
- `join_with_invite` проверяет used_at → если не null, ошибка
- То же сообщение что и для просроченного

---

## UI состояния во время signup

| Состояние | Что показывается |
|-----------|-----------------|
| Форма | Поля email, пароль, confirm |
| Загрузка | Кнопка disabled + спиннер + "Creating account..." |
| Ошибка signup | Красный баннер с текстом ошибки |
| Ошибка invite | "Invalid or expired invite token..." |
| Ошибка setup_business | Текст ошибки |
| Успех | Редирект на /dashboard (full page reload) |

---

## Прогресс-бар

- Тонкие сегменты вверху формы
- Сценарий A: 6 сегментов
- Сценарий B: 4 сегмента
- Текущий и предыдущие сегменты — emerald-600
- Будущие — gray-200
- При переключении сценария (шаг 2) количество сегментов меняется
