# RSS Notifier

RSS Notifier 是 RSS/Atom 訂閱與新文章 Email 通知服務。使用者透過 Email Magic Link 登入、管理 Feed 訂閱；系統定期同步 Feed，並以 Email 通知新文章，也提供免登入的取消訂閱連結。

## 技術架構

- Frontend：Nuxt 4、Vue 3、TypeScript、Element Plus、Tailwindcss。
- Backend：NestJS 12、TypeScript、Prisma 7。
- 資料與背景工作：PostgreSQL 16、Redis 7、BullMQ、NestJS Scheduler。
- 郵件：Nest Mailer、Nodemailer、Handlebars。

## 快速開始

需求：Docker 與 Docker Compose。

1. 複製環境變數範例：

```sh
cp .env.example .env
```

2. 編輯 `.env`，設定 `JWT_SECRET`、SMTP 帳號 `MAIL_USER` / `MAIL_PASS` 與寄件者 `MAIL_FROM`。請將 `JWT_SECRET` 換成隨機秘密值。範例 SMTP 主機為 Ethereal，需填入有效帳號才能收取測試郵件。

3. 建置並啟動服務：

```sh
docker compose up --build -d
docker compose ps
```

Frontend 預設網址為 `http://localhost:3001`，Backend API base URL 為 `http://localhost:3000/api`。Backend container 啟動時會執行 `prisma db push` 與 `prisma generate`。

> `db push` 會依目前 Prisma schema 同步資料庫。正式環境請使用並檢視 migrations，不要將開發環境的自動同步視為正式資料庫遷移流程。

## 環境變數

- PostgreSQL：`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`POSTGRES_PORT`、`DATABASE_URL`。
- Redis：`REDIS_PORT`、`REDIS_URL`。
- Backend：`PORT`、`BACKEND_PORT`、`BACKEND_URL`。`BACKEND_URL` 是通知信取消訂閱連結使用的 Backend origin。
- SMTP：`MAIL_HOST`、`MAIL_PORT`、`MAIL_SECURE`、`MAIL_USER`、`MAIL_PASS`、`MAIL_FROM`。
- JWT 與 Magic Link：`JWT_SECRET`、`JWT_EXPIRES_IN`、`MAGIC_LINK_TTL_MINUTES`、`FRONTEND_URL`。
- Feed 工作：`FEED_SYNC_INTERVAL_MINUTES`（同步間隔，分鐘，預設 15）、`ARTICLE_RETENTION_PER_FEED`（每個 Feed 保留的最新文章數量，預設 5）。同步排程每分鐘檢查是否到期；間隔未設定、非數字或非正數時使用 15 分鐘。
- Frontend：`FRONTEND_PORT`、`NUXT_PUBLIC_API_BASE`。

變數範例與預設值請以 [.env.example](.env.example) 為準。Compose 內 Backend 連線應使用服務名稱 `postgres` 與 `redis`，不可將容器內連線 URL 設為 `localhost`。

## 文件

- [API 文件](api.md)：HTTP endpoint、請求格式、回應與錯誤行為。
- [需求與驗收情境](docs/requirements.md)：產品功能需求及驗收步驟。
- `docs/prompt/`：開發過程使用的需求提示紀錄（`prompt-*.txt`）與驗證畫面（`prompt-*-*.png`）。
- [NestJS 建置流程圖](docs/nest框架建立流程.png) 與 [Nuxt 建置流程圖](docs/nuxt框架建立流程.png)：初始框架建置參考圖。

## Postman

匯入 [API Postman collection](postman/rss-notifier-api.postman_collection.json)。Collection 包含目前 Backend routes 與輸入錯誤案例。使用前設定 `baseUrl` 與 `email`；成功驗證案例需先從登入信取得 token，填入 `magicLinkToken`。訂閱路由使用驗證後自動儲存的 `accessToken`；取消訂閱案例需填入通知信中的 `unsubscribeToken`。

## Background 工作與記錄

- Mail queue：`mail`。Magic Link request enqueue 收件者與登入 URL；Worker 負責套用 Handlebars template 並呼叫 MailerService。
- Feed sync：排程每分鐘檢查是否到期，到期後同步已訂閱 Feed；訂閱時保存文章基準，後續透過 `(feedId, guid)` 去重。單一 Feed 失敗會記錄錯誤並繼續處理其他 Feed。每分鐘的排程結果（包含 `SKIP`）與實際同步統計會寫入 Scheduler TXT。
- Article notification：以 `NotificationLog` 作為持久待辦紀錄，使用同一個 `mail` queue 寄送；BullMQ 指數退避最多 5 次，最終失敗寫入 `FAILED` 與錯誤原因。
- Article cleanup：每日午夜依 `ARTICLE_RETENTION_PER_FEED` 清理每個 Feed 的舊文章，預設保留最新 5 篇；有通知紀錄或仍與啟用中訂閱相關的文章不會被刪除。
- Redis：提供 BullMQ queue backend，不作為主要業務資料庫。
- Magic Link cleanup：每日午夜以批次方式刪除 `usedAt IS NULL` 且 `expiresAt < now` 的資料。
- Scheduler log 以 `/app/logs/YYYY-MM-DD-<SchedulerName>.txt` 分檔，純文字逐行記錄排程結果；每個日期、每個 scheduler 各有獨立檔案。Compose 將 `/app/logs` bind mount 到專案的 `backend/logs`，因此檔案可直接從主機檢視，且 container recreate 或執行 `docker compose down` 後仍會保留。
- 檢視服務 log：

  ```sh
  docker compose logs -f backend
  tail -f "backend/logs/$(date -u +%F)-FeedSyncScheduler.txt"
  ```

停止服務但保留資料：

```sh
docker compose down
```

Scheduler log 位於專案目錄，不受 `docker compose down -v` 影響。清除 Scheduler log 時，先停止服務，再移除文字檔：

```sh
docker compose down
rm backend/logs/*.txt
```

`docker compose down -v` 會刪除 PostgreSQL、Redis 等 named volumes，請只在確定要清除這些持久資料時使用。

## 測試與檢查

Backend 指令依專案規則在 Docker container 執行：

```sh
docker compose exec backend npm test -- --runInBand
docker compose exec backend npm run lint
docker compose exec backend npm run build
```

Frontend build：

```sh
docker compose exec frontend npm run build
```
