# RSS Notifier Backend

Backend 提供 Email Magic Link 登入、Feed 訂閱管理、定期 Feed 同步、新文章通知與取消訂閱確認頁。Feed 同步及寄信使用既有 NestJS Scheduler、BullMQ/Redis 與 Prisma/PostgreSQL。

## 技術組成

- API 與登入：NestJS 12、TypeScript、Prisma 7、PostgreSQL 16、JWT。
- 背景寄信：BullMQ、Redis 7、Nest Mailer、Nodemailer、Handlebars。
- 定期工作：清理過期 Magic Link，並依設定同步所有已訂閱 Feed。
- 開發環境：Docker Compose 提供 Backend、PostgreSQL、Redis 與 Nuxt 4 Frontend dev server。

## 快速啟動

需求：Docker、Docker Compose。

1. 建立環境設定：

```sh
cp .env.example .env
```

2. 編輯 `.env`，至少設定 `JWT_SECRET`、`MAIL_USER`、`MAIL_PASS` 與寄件者 `MAIL_FROM`。`JWT_SECRET` 請換成隨機秘密值；SMTP 範例使用 Ethereal，需填入有效帳號才能收取測試郵件。

3. 建立並啟動服務：

```sh
docker compose up --build -d
docker compose ps
```

Backend API 預設為 `http://localhost:3000`，Frontend dev server 預設為 `http://localhost:3001`。Backend entrypoint 啟動時會執行 `prisma db push` 與 `prisma generate`。

> `db push` 會將目前 Prisma schema 同步到資料庫。正式環境部署前，請先建立並檢視 migration；不要把開發環境的自動同步當成正式資料庫遷移流程。

## 環境變數

- PostgreSQL：`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`POSTGRES_PORT`、`DATABASE_URL`。
- Redis：`REDIS_PORT`、`REDIS_URL`。
- Backend：`PORT`、`BACKEND_PORT`、`BACKEND_URL`。`BACKEND_URL` 是通知信取消訂閱連結使用的公開 Backend origin；本機預設為 `http://localhost:3000`。
- SMTP：`MAIL_HOST`、`MAIL_PORT`、`MAIL_SECURE`、`MAIL_USER`、`MAIL_PASS`、`MAIL_FROM`。
- JWT：`JWT_SECRET`、`JWT_EXPIRES_IN`。
- Magic Link：`MAGIC_LINK_TTL_MINUTES`、`FRONTEND_URL`。
- Frontend dev server：`FRONTEND_PORT`、`NUXT_PUBLIC_API_BASE`。
- `FEED_SYNC_INTERVAL_MINUTES`：Feed 同步間隔（分鐘），預設 15；排程每分鐘檢查一次是否到期。未設定、非數字或非正數時使用 15。

變數範例與預設值請以 [.env.example](.env.example) 為準。Compose 內 Backend 連線使用服務名稱 `postgres` 和 `redis`，不要將容器內連線 URL 改成 `localhost`。

## API

### 健康檢查

```http
GET /
```

成功回應：`200 OK`，內容為 `Hello World!`。

### 要求登入連結

```http
POST /auth/magic-link
Content-Type: application/json

{
    "email": "user@example.com"
}
```

成功回應為 `202 Accepted`，不揭露 Email 是否已註冊：

```json
{
  "message": "If this email can be used, a login link has been sent."
}
```

新 Email 會建立 User；Magic Link token 只以 SHA-256 hash 儲存。信件加入 BullMQ 的 `mail` queue，由 Worker 使用 Handlebars template 和 MailerService 在背景寄送。連結效期由 `MAGIC_LINK_TTL_MINUTES` 設定，預設 15 分鐘。

### 驗證登入連結

```http
GET /auth/magic-link/verify?token=<email-link-token>
```

成功時回傳 `200 OK`、JWT 與使用者公開 ID：

```json
{
  "accessToken": "<jwt>",
  "user": {
    "id": "<public-id>",
    "email": "user@example.com"
  }
}
```

token 不存在、已過期或已使用時回傳 `401 Unauthorized`；token 為單次使用。資料庫使用 BigInt 作為內部 User ID，API 的 `user.id` 與 JWT `userId` 使用 User `publicId`。登入連結目前須由 Email 取得，再呼叫上述 API 完成驗證。

### 訂閱管理

除取消訂閱路由外，所有訂閱路由都需要 `Authorization: Bearer <accessToken>`。

```http
POST /subscriptions
Content-Type: application/json

{ "url": "https://example.com/feed.xml" }
```

新增時會即時抓取並解析 RSS/Atom；無效 Feed、無法連線或本機／內網目的地回傳 `400`，同一使用者重複訂閱回傳 `409`。成功回傳 `201`，包含訂閱 ID／狀態及 Feed 名稱、URL、健康狀態、最近同步時間與錯誤原因。

```http
GET /subscriptions
PATCH /subscriptions/<subscription-id>/pause
PATCH /subscriptions/<subscription-id>/resume
DELETE /subscriptions/<subscription-id>
```

清單只包含目前 JWT 使用者的訂閱；跨使用者操作回傳 `404`。刪除成功回傳 `204`。

### 取消訂閱

通知信連結直接指向 Backend，不需 JWT；成功取消後回傳 HTML 確認頁。無效或遭竄改的 token 回傳 `400`，不會修改訂閱。

```http
GET /subscriptions/unsubscribe?token=<email-unsubscribe-token>
```

## Postman

匯入 [API Postman collection](postman/rss-notifier-api.postman_collection.json)。Collection 包含目前 Backend routes 與輸入錯誤案例。使用前設定 `baseUrl` 與 `email`；成功驗證案例需先從登入信取得 token，填入 `magicLinkToken`。訂閱路由使用驗證後自動儲存的 `accessToken`；取消訂閱案例需填入通知信中的 `unsubscribeToken`。

## Background 工作與記錄

- Mail queue：`mail`。Magic Link request enqueue 收件者與登入 URL；Worker 負責套用 Handlebars template 並呼叫 MailerService。
- Feed sync：排程每分鐘檢查是否到期，到期後同步已訂閱 Feed；訂閱時保存文章基準，後續透過 `(feedId, guid)` 去重。單一 Feed 失敗會記錄錯誤並繼續處理其他 Feed。每分鐘的排程結果（包含 `SKIP`）與實際同步統計會寫入 Scheduler TXT。
- Article notification：以 `NotificationLog` 作為持久待辦紀錄，使用同一個 `mail` queue 寄送；BullMQ 指數退避最多 5 次，最終失敗寫入 `FAILED` 與錯誤原因。
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

## 以下為初次建檔的note

### 初始需手動下指令的程式碼

```
### nestjs 基底
https://docs.nestjs.com/first-steps
https://docs.nestjs.cn/

npm i -g @nestjs/cli
nest new backend
rm -rf backend/.git

cd backend

### prisma 資料庫
https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction?utm_source=chatgpt.com
npm install prisma@prev --save-dev
npm install @prisma/client@7 @prisma/adapter-pg pg
npx prisma init

### 建立 authentication module
nest g module auth
nest g controller auth
nest g service auth
nest g module users
nest g service users
```

### 調整資料庫時要下的指令

```
docker compose exec backend npx prisma migrate dev --create-only
docker compose exec backend npx prisma migrate
docker compose exec backend npx prisma migrate deploy
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\d users"'

docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT
    table_name,
    column_name,
    data_type,
    udt_name
FROM information_schema.columns
WHERE table_name IN ('users', 'magic_links')
ORDER BY table_name, ordinal_position;
SQL

docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT
    tc.constraint_name,
    tc.constraint_type
FROM information_schema.table_constraints tc
WHERE tc.table_name = 'magic_links'
ORDER BY tc.constraint_name;
SQL
```
