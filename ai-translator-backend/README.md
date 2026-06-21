# Babylon Fish (Вавилонская Рыбка) — AI Translator Backend (LiveKit)

**Babylon Fish** — это высокоскоростная служба синхронного перевода голосовых звонков в реальном времени (RU ↔ EN) на базе WebRTC платформы **LiveKit**, транскрипции **Deepgram Nova-3**, перевода **Gemini 2.5 Flash** и синтеза **Google Cloud Journey / ElevenLabs Flash**.

Система разработана с учетом жестких требований к задержкам (<200-400 мс) и поддерживает динамическую фильтрацию угроз безопасности (PII, Prompt Injection) в потоковом неблокирующем режиме.

---

## 1. Функциональные Возможности

1. **Многопользовательский перевод**: Перевод участников внутри одной комнаты LiveKit на основе языкового атрибута (`language=ru` или `language=en`), заданного в токене.
2. **Динамический выбор TTS**: Выбор между Google Cloud TTS (Journey/Neural2) и ElevenLabs Flash v2.5 в реальном времени из панели администратора с механизмом автоматического переключения при ошибках (Auto-Fallback).
3. **Неблокирующая безопасность**: При обнаружении утечки PII или инъекции промпта инцидент немедленно отправляется в очередь модерации Supabase (`public.capture_moderation_queue`), а очищенный текст мгновенно переводится и озвучивается во избежание прерывания разговора.
4. **Интеграция со звонками (Popular Call Apps)**: Подключение к **SIP/VoIP**, захват видео/аудио потока из **Zoom/Teams** по RTMP Ingress, или маршрутизация звонков **Telegram/WhatsApp** через Virtual Audio Cable.

---

## 2. Быстрый Старт

### Установка зависимостей:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

*Примечание: Библиотека `av` требует наличия системного `ffmpeg`. Рекомендуется использовать Python 3.11 или 3.12.*

### Конфигурация (`.env`):
Создайте файл `.env` на основе шаблона `.env.example` и заполните ключи:
* `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
* `DEEPGRAM_API_KEY`
* `GOOGLE_API_KEY` (или `GEMINI_API_KEY`)
* `ELEVENLABS_API_KEY`
* `BOOKMARKS_PGHOST`, `BOOKMARKS_PGPORT`, `BOOKMARKS_PGDATABASE`, `BOOKMARKS_PGUSER`, `BOOKMARKS_PGPASSWORD` (для подключения к Supabase)

---

## 3. Запуск и Тестирование

### 1. Запуск агента переводчика
Запустите фоновый сервис LiveKit агента:
```bash
python3 agent_adk_translator.py dev
```

### 2. Создание тестовой сессии
Сгенерируйте тестовую комнату и JWT-токены участников:
```bash
python3 create_livekit_session.py --room babylon-test --out livekit_test_session.json
```

### 3. Диагностика подключения
Выполните локальную диагностику подключения и медиа-подписок:
```bash
bash run_livekit_connect_debug.sh livekit_test_session.json
```
Результаты диагностики пишутся в `.cursor/debug-b36587.log` (или `../website/.cursor/debug-b36587.log`).

---

## 4. Подключение к Внешним Звонкам (`call_integration.py`)

Используйте утилиту `call_integration.py` для интеграции с внешними линиями связи:

### А. SIP телефония (VoIP)
Направьте входящие телефонные звонки прямо на перевод в комнату LiveKit:
```bash
python3 call_integration.py sip --room babylon-room --number +1234567890 --carrier telnyx
```

### Б. RTMP Ingress (OBS, Zoom, Teams)
Создайте точку приема RTMP потока:
```bash
python3 call_integration.py ingress --room babylon-room --name zoom-stream
```

### В. Пошаговый гайд по Virtual Audio Cable
Инструкции по захвату звука из Telegram, WhatsApp, Zoom и Discord:
```bash
python3 call_integration.py guide
```

---

## 5. Синхронизация с Antigravity

Для передачи проекта Babylon Fish в зеркало Antigravity (`AuthRAG`) выполните из корня каталога `website`:
```bash
npm run keept:sync-authrag:apply
```
Скрипт автоматически скопирует веб-приложение, базу настроек и весь бэкенд `ai-translator-backend/` в зеркало и запушит изменения в ветку `bookmarks-bro`.
