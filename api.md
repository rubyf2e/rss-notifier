# RSS Notifier API

本文整理目前 Backend 實際提供的 HTTP API。Postman Collection 的範例與測試用來確認請求及成功回應；若與 Controller、DTO、Service 的實際行為不同，以目前 Backend contract 為準，並在下文標示差異。

## 共通資訊

- Base URL：由部署環境決定；Postman 預設為 `http://localhost:3000`。
- JSON 請求使用 `Content-Type: application/json`。未要求 JSON body 的 endpoint 不需要此 header。
- 需要登入的 endpoint 使用 `Authorization: Bearer <accessToken>`。
- 錯誤採 NestJS 預設例外格式，通常包含 `statusCode`、`message`、`error`。ValidationPipe 驗證失敗時，`message` 為驗證訊息陣列；其他例外通常是字串。
- 目前共有 **9 個唯一的 method + path endpoint**。Postman Collection 包含成功流程、輸入驗證、分頁、授權與錯誤情境測試。

## Service

### 健康檢查

`GET /api/`

- Authentication：不需要。
- Request headers：無。
- Path / query / body：無。
- 成功：`200 OK`，純文字 `Hello World!`。
- Error responses：Controller 未定義此 endpoint 的特定錯誤回應。

## Public / Authentication

### 申請 Email 登入連結

`POST /api/auth/magic-link`

- Authentication：不需要。
- Request headers：`Content-Type: application/json`。
- Request body：

```json
{
  "email": "user@example.com"
}
```

- 欄位與驗證：`email` 必須是有效 Email 格式；缺少或格式無效會回傳 `400`。
- 成功：`202 Accepted`。

```json
{
  "message": "If this email can be used, a login link has been sent."
}
```

- Auth 行為：以相同訊息回應，不在 response 中揭露該 Email 是否已存在；目前 Service 會建立或取得使用者、建立登入連結並排入寄信工作。登入連結期限由 `MAGIC_LINK_TTL_MINUTES` 設定，未設定或值無效時使用 15 分鐘。
- Error responses：DTO 驗證失敗為 `400 Bad Request`，NestJS 預設回應的 `message` 為驗證訊息陣列。其他寄信佇列或伺服器錯誤沒有在此 endpoint 定義額外的 API error mapping。

### 驗證 Email 登入連結

`GET /api/auth/magic-link/verify`

- Authentication：不需要既有 access token。
- Request headers：無。
- Query parameters：`token` 必填，字串且不可為空。缺少或空值回傳 `400`。
- Path / body：無。
- 成功：`200 OK`。

```json
{
  "accessToken": "<JWT access token>",
  "user": {
    "id": "<user public UUID>",
    "email": "user@example.com"
  }
}
```

- 欄位說明：`user.id` 是公開 UUID，不是資料庫內部 ID。登入連結只能使用一次，且不可逾期；原始 magic-link token 不會出現在成功 response。
- Error responses：token 無效、過期或已使用時回傳 `401 Unauthorized`，訊息為 `Magic link is invalid, expired, or already used.`。缺少或空 token 為 `400 Bad Request`，`message` 為 ValidationPipe 的驗證訊息陣列。
- Auth 行為：成功驗證後簽發 JWT。JWT 期限由 `JWT_EXPIRES_IN` 設定；本 API 不在 response 中另回傳過期時間。

## Subscriptions

以下端點（除郵件取消訂閱端點外）都需要有效的 Bearer access token。JWT 的 `userId` claim 是使用者公開 UUID；訂閱查詢及異動均限制在該使用者名下。

### 建立訂閱

`POST /api/subscriptions`

- Authentication：需要 Bearer access token。
- Request headers：`Authorization: Bearer <accessToken>`、`Content-Type: application/json`。
- Request body：

```json
{
  "url": "https://example.com/feed.xml"
}
```

- 欄位與驗證：`url` 必填，必須是含 protocol 的 HTTP 或 HTTPS URL。Backend 另會檢查目的主機是否為公開位址、取得並解析 RSS/Atom feed；無效、無法連線、無效 redirect、非公開位址或非有效 feed 會回傳 `400`。Feed redirect 最多 5 次，response body 上限為 5 MiB。
- 成功：`201 Created`。下列欄位依 Service response mapping；日期由 JSON 序列化為 ISO 8601 字串。

```json
{
  "id": "<subscription public UUID>",
  "status": "ACTIVE",
  "createdAt": "<ISO 8601 datetime>",
  "feed": {
    "title": "Example Feed",
    "url": "https://example.com/feed.xml",
    "status": "HEALTHY",
    "lastSyncedAt": "<ISO 8601 datetime>",
    "lastError": null
  }
}
```

- 欄位說明：`id` 是訂閱公開 UUID；`feed.title` 若來源沒有標題，Backend 以 feed URL 作為標題。`lastSyncedAt`、`lastError` 可能為 `null`。
- Error responses：`400 Bad Request`（DTO 驗證或 feed URL/fetch/parse 失敗）；`401 Unauthorized`（缺少 Bearer token 時訊息為 `Bearer access token is required.`；JWT 無效或過期時為 `Access token is invalid or expired.`；使用者已不存在時為 `User no longer exists.`）；`409 Conflict`（該使用者已訂閱此 feed，訊息 `This feed is already subscribed.`）。DTO 驗證錯誤的 `message` 為訊息陣列。

### 列出訂閱

`GET /api/subscriptions`

- Authentication：需要 Bearer access token。
- Request headers：`Authorization: Bearer <accessToken>`。
- Query parameters：
  - `page`：選填，正整數，預設 `1`。
  - `limit`：選填，正整數，預設 `20`，最大 `100`。
- Path / body：無。
- 成功：`200 OK`，只列出目前登入使用者的訂閱，依建立時間由新到舊排序。

```json
{
  "items": [
    {
      "id": "<subscription public UUID>",
      "status": "ACTIVE",
      "createdAt": "<ISO 8601 datetime>",
      "feed": {
        "title": "Example Feed",
        "url": "https://example.com/feed.xml",
        "status": "HEALTHY",
        "lastSyncedAt": "<ISO 8601 datetime>",
        "lastError": null
      }
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1,
  "totalPages": 1
}
```

- 欄位說明：`items` 為訂閱 response 陣列；`total` 是使用者的訂閱總數；`totalPages` 為總頁數，沒有訂閱時為 `0`。超出資料範圍的有效頁數會回傳空的 `items`。
- Error responses：`400 Bad Request`（`page` / `limit` 不是整數、小於 1，或 `limit` 大於 100；`message` 為驗證訊息陣列）；`401 Unauthorized`（缺少 Bearer token 時訊息為 `Bearer access token is required.`；JWT 無效或過期時為 `Access token is invalid or expired.`；使用者已不存在時為 `User no longer exists.`）。

### 暫停訂閱

`PATCH /api/subscriptions/:publicId/pause`

- Authentication：需要 Bearer access token。
- Request headers：`Authorization: Bearer <accessToken>`。
- Path parameters：`publicId` 為訂閱公開 UUID。Controller 未設定 UUID 格式驗證；找不到該使用者名下的訂閱時回傳 `404`。
- Query / body：無。
- 成功：`200 OK`，回傳訂閱物件，`status` 為 `PAUSED`，其他欄位同「建立訂閱」response。已是 `PAUSED` 時仍成功回傳目前訂閱。
- Error responses：`401 Unauthorized`（缺少 Bearer token 時訊息為 `Bearer access token is required.`；JWT 無效或過期時為 `Access token is invalid or expired.`；使用者已不存在時為 `User no longer exists.`）；`404 Not Found`（訂閱不存在或不屬於目前使用者），訊息 `Subscription not found.`。

### 恢復訂閱

`PATCH /api/subscriptions/:publicId/resume`

- Authentication：需要 Bearer access token。
- Request headers：`Authorization: Bearer <accessToken>`。
- Path parameters：`publicId` 為訂閱公開 UUID；格式不另外驗證。
- Query / body：無。
- 成功：`200 OK`，回傳訂閱物件，`status` 為 `ACTIVE`，其他欄位同「建立訂閱」response。已是 `ACTIVE` 時仍成功回傳目前訂閱。
- Error responses：`401 Unauthorized`（缺少 Bearer token 時訊息為 `Bearer access token is required.`；JWT 無效或過期時為 `Access token is invalid or expired.`；使用者已不存在時為 `User no longer exists.`）；`404 Not Found`（訂閱不存在或不屬於目前使用者），訊息 `Subscription not found.`。

### 刪除訂閱

`DELETE /api/subscriptions/:publicId`

- Authentication：需要 Bearer access token。
- Request headers：`Authorization: Bearer <accessToken>`。
- Path parameters：`publicId` 為訂閱公開 UUID；格式不另外驗證。
- Query / body：無。
- 成功：`204 No Content`，沒有 response body。
- Error responses：`401 Unauthorized`（Bearer token 無效等）；`404 Not Found`（訂閱不存在或不屬於目前使用者），訊息 `Subscription not found.`。

## Unsubscribe

### 從通知 Email 取消訂閱

`GET /api/subscriptions/unsubscribe`

- Authentication：不需要 JWT。使用通知 Email 中的取消訂閱 token。
- Request headers：無。
- Query parameters：`token` 必填，64 個小寫十六進位字元。
- Path / body：無。
- 成功：`200 OK`，`Content-Type: text/html; charset=utf-8`，回傳取消確認 HTML 頁面。若該訂閱已取消，再次使用仍回傳相同成功頁面。
- Error responses：token 缺少或格式錯誤時為 `400 Bad Request`，`message` 為 DTO 驗證訊息陣列；格式正確但找不到對應訂閱時為 `400 Bad Request`，訊息為 `Unsubscribe link is invalid.`。
- 安全與欄位說明：token 不會由訂閱建立或列表 API 回傳；Backend 僅保存 token hash。此公開端點透過 Email token 指定要取消的訂閱，不使用登入使用者身分。

## 非 HTTP 工作

Feed 同步由 Scheduler 執行；新文章通知及重試使用既有 mail queue/worker。這些背景工作目前不提供 HTTP endpoint。
