# 🚀 Quick Start Guide

## ✅ Project Status: READY TO RUN

Весь проект полностью реализован и готов к запуску. Архитектура валидирована специалистами.

---

## 🎯 Этап 1: Инициализация (5 минут)

### 1.1 Установка Зависимостей
```bash
npm install
```

### 1.2 Конфигурация
```bash
# Копируем .env файл
cp .env.example .env

# Редактируем и добавляем API ключи:
# - KIMAI_URL (адрес вашего Kimai)
# - KIMAI_API_KEY (получить из Kimai settings)
# - NOTION_API_KEY (создать интеграцию в Notion)
nano .env
```

---

## 🐳 Этап 2: Запуск Сервисов (2 минуты)

### 2.1 Запуск PostgreSQL и Redis
```bash
docker-compose up -d

# Проверяем что все работает:
docker-compose ps

# Смотрим логи если есть проблемы:
docker-compose logs postgres
docker-compose logs redis
```

### 2.2 Применяем миграции БД
```bash
# ВАЖНО: Это создает таблицы в PostgreSQL
npx prisma migrate deploy

# Или в режиме разработки (создает миграцию):
npx prisma migrate dev

# Смотрим данные в GUI:
npx prisma studio
# Откроется http://localhost:5555
```

---

## ▶️ Этап 3: Запуск Приложения (1 минута)

### В режиме разработки (с hot-reload):
```bash
npm run start:dev

# Логи появятся в консоли:
# ✅ Database connected successfully
# ✅ Cron scheduler started
# ╔═══════════════════════════════════╗
# ║ 🎉 Kimai Sync Service Started    ║
# ...
```

### Или в production:
```bash
npm run build
npm run start:prod
```

---

## 🧪 Этап 4: Тестирование API (2 минуты)

### 4.1 Проверяем что приложение работает:
```bash
curl http://localhost:3000/health

# Ответ:
# {"status":"ok","timestamp":"2024-03-08T10:30:00.000Z"}
```

### 4.2 Запускаем полную синхронизацию (3 года данных):
```bash
curl -X POST http://localhost:3000/sync/full

# Ответ:
# {"jobId":1,"status":"queued"}

# Проверяем статус:
curl http://localhost:3000/sync/status/1
```

### 4.3 Запускаем синхронизацию текущей недели:
```bash
curl -X POST http://localhost:3000/sync/weekly

# Ответ:
# {"jobId":2,"status":"queued"}
```

### 4.4 Смотрим логи выполнения:
```bash
# В консоли где запустили npm run start:dev увидите:
# 🔄 Starting full history sync (last 3 years)...
# 📥 Fetching Kimai entries from 2021-03-08T00:00:00.000Z to 2024-03-08T00:00:00.000Z
# ✅ Fetched 1234 total entries
# ✅ Full sync completed: 1234 synced, 0 failed (3456ms)
```

---

## 📊 Этап 5: Мониторинг

### 5.1 Смотрим данные в Prisma Studio:
```bash
npx prisma studio
# http://localhost:5555

# Таблицы:
# - Project (список проектов из Kimai)
# - TimeEntry (все синхронизированные записи)
```

### 5.2 Проверяем Redis очереди:
```bash
redis-cli

# Посмотреть все ключи:
KEYS bull:*

# Посмотреть состояние очереди:
HGETALL bull:sync-jobs:jobs
```

### 5.3 Автоматическая синхронизация каждые 5 минут:
```
Логи будут показывать:
⏰ Cron triggered - queuing weekly sync...
✅ Weekly sync job queued by scheduler
```

---

## ⚙️ Конфигурация

### Environment Variables (.env)
```env
# NestJS
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Kimai API
KIMAI_URL=https://your-kimai.com
KIMAI_API_KEY=xxx

# PostgreSQL
DATABASE_URL=postgresql://kimai_user:kimai_password@localhost:5432/kimai_sync

# Redis
REDIS_URL=redis://localhost:6379

# Notion
NOTION_API_KEY=xxx

# Sync
SYNC_INTERVAL=*/5 * * * *  # Каждые 5 минут
SYNC_ENABLED=true
```

### Изменить интервал синхронизации:
```env
# Каждый час:
SYNC_INTERVAL=0 * * * *

# Каждый день в 02:00:
SYNC_INTERVAL=0 2 * * *

# Каждый понедельник в четверг в 09:00:
SYNC_INTERVAL=0 9 * * 4
```

---

## 🔧 Команды Разработки

```bash
# Запустить тесты
npm test

# С покрытием
npm run test:cov

# Запустить линтер
npm run lint

# Форматировать код
npm run format

# Смотреть данные БД
npx prisma studio

# Создать новую миграцию
npx prisma migrate dev --name add_feature

# Откатить последнюю миграцию (dev only)
npx prisma migrate resolve --rolled-back 20240308000000_add_feature
```

---

## 📡 API Endpoints

| Метод | Endpoint | Описание |
|-------|----------|---------|
| POST | `/sync/full` | Синхронизировать 3 года данных |
| POST | `/sync/weekly` | Синхронизировать текущую неделю |
| GET | `/sync/status/:jobId` | Статус задачи синхронизации |
| GET | `/health` | Health check |

---

## 🐛 Отладка

### Если приложение не запускается:
```bash
# 1. Проверяем что PostgreSQL включен:
docker-compose ps

# 2. Проверяем что Redis работает:
redis-cli ping
# Должно вернуть: PONG

# 3. Смотрим логи Docker:
docker-compose logs -f postgres
docker-compose logs -f redis

# 4. Проверяем DATABASE_URL в .env:
echo $DATABASE_URL
postgresql://kimai_user:kimai_password@localhost:5432/kimai_sync

# 5. Тестируем подключение:
psql postgresql://kimai_user:kimai_password@localhost:5432/kimai_sync
```

### Если синхронизация не работает:
```bash
# 1. Проверяем KIMAI_URL и KIMAI_API_KEY:
echo $KIMAI_URL
echo $KIMAI_API_KEY

# 2. Тестируем API напрямую:
curl -H "Authorization: Bearer $KIMAI_API_KEY" \
  "$KIMAI_URL/api/timesheets?begin=2024-01-01T00:00:00&end=2024-01-02T23:59:59&size=1"

# 3. Смотрим логи приложения для ошибок:
# Должны увидеть либо успешное получение данных либо ошибку
```

### Если Notion синхронизация не работает:
```bash
# 1. Проверяем NOTION_API_KEY:
echo $NOTION_API_KEY

# 2. Тестируем API Notion:
curl -H "Authorization: Bearer $NOTION_API_KEY" \
  -H "Notion-Version: 2026-03-11" \
  https://api.notion.com/v1/databases/xxx

# 3. В Prisma Studio добавьте notionDatabaseId к проекту:
npx prisma studio
# Project → найти проект → добавить notionDatabaseId (UUID из URL Notion базы)

# 4. Смотрите логи что Notion получает ошибку или успех
```

---

## ✅ Финальная Проверка

Всё готово? Проверьте:

- [ ] `npm install` успешно установил зависимости
- [ ] `.env` заполнен с API ключами
- [ ] `docker-compose up -d` запустил PostgreSQL и Redis
- [ ] `npx prisma migrate deploy` создал таблицы
- [ ] `npm run start:dev` запустил приложение без ошибок
- [ ] `curl http://localhost:3000/health` вернул 200 OK
- [ ] `curl -X POST http://localhost:3000/sync/full` вернул jobId
- [ ] `curl http://localhost:3000/sync/status/1` показал статус

Если всё работает — **поздравляю, проект готов!** 🎉

---

## 📚 Дальнейшие Шаги

1. **Настроить Notion шаблоны** — Создать базы в Notion и связать их с проектами
2. **Мониторинг** — Настроить логирование и мониторинг в продакшене
3. **CI/CD** — Добавить GitHub Actions для автоматического деплоя
4. **Документация** — Документировать API и интеграции по специфике вашего Kimai

---

## 🆘 Need Help?

Смотрите:
- [README.md](./README.md) — Полная документация
- [Kimai API spec](./openapi.json) — OpenAPI спецификация
- [Prisma documentation](https://www.prisma.io/docs/) — ORM документация
- [NestJS docs](https://docs.nestjs.com/) — NestJS документация

---

**Версия**: 1.0.0  
**Последнее обновление**: March 8, 2024  
**Статус**: ✅ ГОТОВО К ИСПОЛЬЗОВАНИЮ
