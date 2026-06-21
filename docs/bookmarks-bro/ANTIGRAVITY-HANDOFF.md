# Antigravity Handoff — Keep It For Me & Babylon Fish Integration

> **Copy-paste this entire file into Antigravity as session context.**  
> **Updated:** 2026-06-21  
> **Audience:** Google Antigravity autonomous agent  
> **Human operator:** Vlad / Autoro — parallel dev with Cursor IDE

---

## 1. Архитектурное Разделение Проектов

В соответствии с новыми требованиями, **Keep It For Me (Keept)** и **Babylon Fish** представляют собой два **разных, изолированных проекта**, которые тесно интегрируются между собой через API-интерфейсы и единую базу данных Supabase:

```
  [ Keep It For Me (Keept) ]                       [ Babylon Fish ]
  (База знаний, закладки, контакты)               (Синхронный голосовой переводчик)
             │                                               │
             │ (Запрос контактов и контекста)                │ (Запуск перевода)
             ▼                                               ▼
     [ API / DB Supabase ] ◄──────────────────────── [ LiveKit Agent / ADK ]
     - bookmarks_bro.contacts                        - Загрузка контекста контакта
     - bookmarks_bro.bookmarks                       - Генерация подсказок на лету
```

### 1.1 Keep It For Me (Keept) — `keept.me`
Персональная база знаний, хранилище закладок, заметок и умных контактов:
* **Информационный хаб**: Собирает веб-страницы, ссылки, файлы и структурирует их с помощью ИИ.
* **База умных контактов (`bookmarks_bro.contacts`)**: Хранит профили людей, их контактную информацию, а главное — **контекст контакта** (биографию, интересы, резюме прошлых встреч, связанные теги).
* **Интерфейс вызова**: Предоставляет кнопку «Позвонить» (Call with Babylon Fish) на карточке контакта, которая запускает сессию перевода.

### 1.2 Babylon Fish (Вавилонская Рыбка) — `ai-translator-backend/`
Высокоскоростная инфраструктура синхронного перевода голосовых звонков в реальном времени:
* **Медиа-сервер (LiveKit)**: Обеспечивает голосовую связь (WebRTC) с минимальной задержкой.
* **Потоковый ADK-агент**: Реализует транскрипцию (Deepgram Nova-3), перевод (Gemini 2.5 Flash) и синтез речи (Google Journey / ElevenLabs Flash) в неблокирующем потоковом режиме.
* **Контекстный движок подсказок (Hints Engine)**: Загружает контекст вызываемого контакта из базы знаний Keept и Swoop. В ходе разговора генерирует **подсказки/советы на экране в реальном времени** (например, напоминая обсудить тему из общих закладок или предупреждая о профессиональной специализации собеседника).

---

## 2. Модель Данных Контактов (`bookmarks_bro.contacts`)

Для хранения контактов в схеме `bookmarks_bro` СУБД Supabase используется следующая таблица:

```sql
create table if not exists bookmarks_bro.contacts (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  company text,
  job_title text,
  context_summary text, -- AI-сгенерированное или ручное описание бэкграунда и интересов собеседника
  tags jsonb default '[]'::jsonb, -- Связанные интересы/теги для фильтрации подсказок
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bb_contacts_owner on bookmarks_bro.contacts(owner_id);
```

---

## 3. Сценарий Интеграции и Движок Подсказок (Real-Time Hints)

1. **Инициация звонка**:
   Пользователь нажимает «Позвонить» на карточке контакта *John Doe* в интерфейсе Keept.
   * Keept генерирует JWT-токены LiveKit, связывая сессию с ID контакта (`contact_id`).
   * Открывается окно звонка Babylon Fish.

2. **Загрузка контекста**:
   Агент Babylon Fish при входе в комнату считывает `contact_id` из атрибутов сессии и запрашивает профиль контакта из таблицы `bookmarks_bro.contacts`, а также связанные с его тегами статьи из `bookmarks_bro.page_content`.

3. **Анализ разговора и выдача подсказок (Hints Engine)**:
   При обмене репликами, транскрибированный текст анализируется фоновым ИИ-агентом (Gemini 2.5 Flash). Он сравнивает контекст звонка, интересы контакта и базу знаний пользователя с текущей темой обсуждения и формирует лаконичные подсказки на экране.
   * *Пример*: Собеседник говорит по-английски: *"We are looking for new investment opportunities in climate tech."*
   * *Контекст контакта*: John Doe — венчурный партнер, интересующийся альтернативной энергетикой. Закладки пользователя содержат статью *"Top 10 European Climate Tech Startups 2026"*.
   * *Результат*: На экране пользователя всплывает карточка-подсказка: 
     💡 **Hint**: John Doe активно инвестирует в альтернативную энергию. Расскажите ему о европейских Climate Tech стартапах из ваших закладок!

---

## 4. Задачи для Реализации (Твои Треки)

### Трек A: Бэкенд Умных Контактов в `agent-api/main.py`
Реализовать REST API эндпоинты для управления контактами:
* `GET /api/v1/keept/contacts` — получить список контактов пользователя.
* `POST /api/v1/keept/contacts` — создать новый контакт.
* `PUT /api/v1/keept/contacts/{id}` — обновить карточку и контекст контакта (`context_summary`).
* `DELETE /api/v1/keept/contacts/{id}` — удалить контакт.
* `GET /api/v1/keept/contacts/{id}/context-hints` — API, который вызывается бэкендом Babylon Fish для получения контекста и генерации подсказок на основе текущей темы разговора.

### Трек B: Интерфейс Контактов в React (`src/bookmarksBro/`)
* Разработать новую вкладку **Contacts** в приложении Keept.
* Реализовать список контактов, форму добавления/редактирования, отображение блока **Contact Context Summary**.
* Добавить на карточку контакта кнопку 📞 **Call with Babylon Fish**.
* Сверстать окно активного вызова:
  * Голосовой WebRTC-интерфейс (LiveKit).
  * Бегущая лента синхронного перевода.
  * Панель **Live Context Hints** (где на лету появляются подсказки от ИИ).

### Трек C: Движок Подсказок в `ai-translator-backend/agent_adk_translator.py`
* Внедрить новый узел графа **HintsEngineNode**, работающий параллельно с переводом.
* При старте сессии получать `contact_id` из токена.
* Посылать реплики разговора в фоновый ИИ-поток для генерации контекстных подсказок на основе данных Keept и Swoop.
* Публиковать сгенерированные подсказки в топик данных LiveKit (или записывать в БД) для отображения на фронтенде.

---

## 5. Запуск и Тестирование

### Запуск Keept (База знаний + Контакты)
Из корня проекта `website`:
```bash
npm run dev
```

### Запуск Babylon Fish (Переводчик + Подсказки)
Из папки `ai-translator-backend`:
```bash
# Активировать окружение и запустить ADK-агента
source .venv/bin/activate
python3 agent_adk_translator.py dev
```

### Эмуляция звонка с контекстом
```bash
# Запустить интеграционный скрипт с указанием контакта
python3 call_integration.py ingress --room test-room --name zoom-stream
```

Изменения автоматически зеркалируются в репозиторий `AuthRAG` для Antigravity с помощью команды:
```bash
npm run keept:sync-authrag:apply
```
