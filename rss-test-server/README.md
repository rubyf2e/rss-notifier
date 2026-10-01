# RSS Test Server

最小 RSS 2.0 測試 Server，使用 Node.js + Express。不使用 DB、Docker 或 ORM，資料存於記憶體，重啟後會重置為預設的 1 篇文章。

## 安裝與啟動

```bash
cd rss-test-server
npm install
npm start
```

預設監聽 `http://localhost:4000`，可用 `PORT` 環境變數覆寫（例如 `PORT=5000 npm start`）。

## API

### `GET /feed.xml`

回傳 RSS 2.0 格式的 XML feed，包含目前所有文章（`guid`、`title`、`link`、`pubDate`）。

```bash
curl http://localhost:4000/feed.xml
```

### `POST /articles`

新增一篇文章，`title` 與 `link` 為必填，`guid` 與 `pubDate` 由 Server 自動產生。

```bash
curl -X POST http://localhost:4000/articles \
  -H "Content-Type: application/json" \
  -d '{"title":"新文章","link":"http://example.com/2"}'
```

成功會回傳 `201` 與新建立的文章 JSON；缺少 `title` 或 `link` 會回傳 `400`。

### `GET /articles`

列出目前所有文章（JSON 陣列）。

```bash
curl http://localhost:4000/articles
```

### `DELETE /articles/:guid`

依 `guid` 刪除指定文章，成功回傳被刪除的文章 JSON；找不到則回傳 `404`。

```bash
curl -X DELETE http://localhost:4000/articles/<guid>
```

### `GET /rss/invalid`

回傳非 RSS 的純文字內容，用於測試 RSS parsing 失敗的處理。

```bash
curl http://localhost:4000/rss/invalid
```

### `GET /rss/slow?seconds=N`

延遲 N 秒後才回傳 RSS，用於測試 timeout 處理。

```bash
curl http://localhost:4000/rss/slow?seconds=3
```

### `GET /rss/hang`

建立 RSS response 後保持連線但不完成，用於測試 request timeout。

```bash
curl --max-time 2 http://localhost:4000/rss/hang
```

### `GET /rss/slow-stream?chunks=N&delayMs=M`

將合法 RSS 分成多個 chunk 傳送，每個 chunk 之間等待指定毫秒數；`chunks` 最多 20、`delayMs` 最多 5000。用於測試 streaming timeout。

```bash
curl "http://localhost:4000/rss/slow-stream?chunks=4&delayMs=500"
```

### `GET /rss/large?mb=N`

產生約 N MB 大小的 RSS，用於測試 response-size limit。

```bash
curl http://localhost:4000/rss/large?mb=5 -o large.xml
```

### `GET /rss/large-stream?mb=N`

以 chunked streaming 方式傳送大型合法 RSS，不預先建立完整內容，也不強制提供 `Content-Length`；`mb` 最多 20。用於測試 response-size limit。

```bash
curl http://localhost:4000/rss/large-stream?mb=5 -o large-stream.xml
```

### `GET /rss/status/:code`

回傳指定的 HTTP status code（body 仍為 RSS），用於測試錯誤處理與 feed error recovery。

```bash
curl -i http://localhost:4000/rss/status/500
```

### `GET /rss/redirect?to=URL`

以 `302` redirect 到指定的 `to` URL，用於測試 redirect 處理與 SSRF 防護。

```bash
curl -i "http://localhost:4000/rss/redirect?to=http://localhost:4000/feed.xml"
```

### `GET /rss/redirect-loop/a`、`GET /rss/redirect-loop/b`

兩個 endpoint 互相回傳 `302` redirect，每個 request 只處理一次，用於測試 redirect limit。

```bash
curl -L --max-redirs 3 http://localhost:4000/rss/redirect-loop/a
```

### `POST /test/feed-mode`

在記憶體中切換 `/feed.xml` 的狀態。`ERROR` 回傳 HTTP 500，`HEALTHY` 恢復正常 RSS；Server 重啟後預設為 `HEALTHY`。用於測試 feed error recovery。

```bash
curl -X POST http://localhost:4000/test/feed-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"ERROR"}'
curl -X POST http://localhost:4000/test/feed-mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"HEALTHY"}'
```
