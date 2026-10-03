const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 4000;

const CHANNEL = {
  title: "RSS Test Server",
  link: `http://localhost:${PORT}`,
  description: "用於測試 RSS 通知功能的最小 RSS 2.0 Server",
};

// 記憶體儲存，重啟後資料重置
const articles = [
  {
    guid: crypto.randomUUID(),
    title: "第一篇測試文章",
    link: `http://localhost:${PORT}/articles/1`,
    pubDate: new Date().toUTCString(),
  },
];

let feedMode = "HEALTHY";

const SLOW_STREAM_MAX_CHUNKS = 20;
const SLOW_STREAM_MAX_DELAY_MS = 5000;
const LARGE_STREAM_MAX_MB = 20;
const STREAM_CHUNK_SIZE = 64 * 1024;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRssFeed() {
  const items = articles
    .map(
      (article) => `
    <item>
      <guid>${escapeXml(article.guid)}</guid>
      <title>${escapeXml(article.title)}</title>
      <link>${escapeXml(article.link)}</link>
      <pubDate>${escapeXml(article.pubDate)}</pubDate>
    </item>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(CHANNEL.title)}</title>
    <link>${escapeXml(CHANNEL.link)}</link>
    <description>${escapeXml(CHANNEL.description)}</description>${items}
  </channel>
</rss>`;
}

app.get("/feed.xml", (req, res) => {
  if (feedMode === "ERROR") {
    return res.status(500).type("application/rss+xml").send(buildRssFeed());
  }

  res.type("application/rss+xml").send(buildRssFeed());
});

app.post("/test/feed-mode", (req, res) => {
  const { mode } = req.body || {};

  if (mode !== "HEALTHY" && mode !== "ERROR") {
    return res.status(400).json({ message: "mode 必須是 HEALTHY 或 ERROR" });
  }

  feedMode = mode;

  return res.json({ mode: feedMode });
});

app.get("/articles", (req, res) => {
  res.json(articles);
});

app.post("/articles", (req, res) => {
  const { title, link } = req.body || {};

  if (!title || !link) {
    return res.status(400).json({ message: "title 與 link 為必填欄位" });
  }

  const article = {
    guid: crypto.randomUUID(),
    title,
    link,
    pubDate: new Date().toUTCString(),
  };

  articles.unshift(article);

  return res.status(201).json(article);
});

app.delete("/articles/:guid", (req, res) => {
  const index = articles.findIndex(
    (article) => article.guid === req.params.guid,
  );

  if (index === -1) {
    return res.status(404).json({ message: "找不到指定 guid 的文章" });
  }

  const [removed] = articles.splice(index, 1);

  return res.json(removed);
});

// 回傳非 RSS 內容，用於測試 parser 錯誤處理
app.get("/rss/invalid", (req, res) => {
  res.type("text/plain").send("這不是一個有效的 RSS feed");
});

// 延遲指定秒數後才回傳 RSS，用於測試 timeout
app.get("/rss/slow", (req, res) => {
  const seconds = Number(req.query.seconds) || 0;

  setTimeout(() => {
    res.type("application/rss+xml").send(buildRssFeed());
  }, seconds * 1000);
});

// 建立 response 後保持連線，讓 Client 自己觸發 request timeout
app.get("/rss/hang", (req, res) => {
  res.status(200).type("application/rss+xml");
  res.write('<?xml version="1.0" encoding="UTF-8"?>\n');
});

// 將合法 RSS 分段傳送，用於測試 streaming timeout
app.get("/rss/slow-stream", (req, res) => {
  const chunks = Math.min(
    Math.max(Number.parseInt(req.query.chunks, 10) || 1, 1),
    SLOW_STREAM_MAX_CHUNKS,
  );
  const delayMs = Math.min(
    Math.max(Number.parseInt(req.query.delayMs, 10) || 0, 0),
    SLOW_STREAM_MAX_DELAY_MS,
  );
  const xml = buildRssFeed();
  const chunkSize = Math.ceil(xml.length / chunks);
  let offset = 0;

  res.type("application/rss+xml");

  const writeNextChunk = () => {
    if (res.destroyed) {
      return;
    }

    const nextOffset = Math.min(offset + chunkSize, xml.length);
    res.write(xml.slice(offset, nextOffset));
    offset = nextOffset;

    if (offset >= xml.length) {
      return res.end();
    }

    setTimeout(writeNextChunk, delayMs);
  };

  writeNextChunk();
});

// 以固定大小的 buffer 逐段產生 RSS，避免一次建立完整 payload
app.get("/rss/large-stream", (req, res) => {
  const mb = Math.min(
    Math.max(Number.parseInt(req.query.mb, 10) || 1, 1),
    LARGE_STREAM_MAX_MB,
  );
  const targetBytes = mb * 1024 * 1024;
  const prefix = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(CHANNEL.title)}</title>
    <link>${escapeXml(CHANNEL.link)}</link>
    <description>${escapeXml(CHANNEL.description)}</description>
    <item>
      <guid>${crypto.randomUUID()}</guid>
      <title>large-stream-payload</title>
      <link>${escapeXml(CHANNEL.link)}</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[`;
  const suffix = "]]></description>\n    </item>\n  </channel>\n</rss>";
  const paddingBytes = Math.max(
    targetBytes - Buffer.byteLength(prefix + suffix),
    0,
  );
  const paddingChunk = Buffer.alloc(STREAM_CHUNK_SIZE, "x");
  let remaining = paddingBytes;

  res.type("application/rss+xml");
  res.write(prefix);

  while (remaining > 0) {
    const chunk =
      remaining >= paddingChunk.length
        ? paddingChunk
        : paddingChunk.subarray(0, remaining);

    if (!res.write(chunk)) {
      res.once("drain", () =>
        writeRemainingPadding(
          res,
          paddingChunk,
          remaining - chunk.length,
          suffix,
        ),
      );
      return;
    }

    remaining -= chunk.length;
  }

  res.end(suffix);
});

function writeRemainingPadding(res, paddingChunk, remaining, suffix) {
  while (remaining > 0) {
    const chunk =
      remaining >= paddingChunk.length
        ? paddingChunk
        : paddingChunk.subarray(0, remaining);

    if (!res.write(chunk)) {
      res.once("drain", () =>
        writeRemainingPadding(
          res,
          paddingChunk,
          remaining - chunk.length,
          suffix,
        ),
      );
      return;
    }

    remaining -= chunk.length;
  }

  res.end(suffix);
}

// 產生指定大小（MB）的 RSS，用於測試 response-size limit
app.get("/rss/large", (req, res) => {
  const mb = Number(req.query.mb) || 1;
  const targetBytes = mb * 1024 * 1024;
  const padding = "x".repeat(targetBytes);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(CHANNEL.title)}</title>
    <link>${escapeXml(CHANNEL.link)}</link>
    <description>${escapeXml(CHANNEL.description)}</description>
    <item>
      <guid>${crypto.randomUUID()}</guid>
      <title>large-payload</title>
      <link>${escapeXml(CHANNEL.link)}</link>
      <pubDate>${new Date().toUTCString()}</pubDate>
      <description><![CDATA[${padding}]]></description>
    </item>
  </channel>
</rss>`;

  res.type("application/rss+xml").send(xml);
});

// 回傳指定的 HTTP status，用於測試錯誤處理與 feed error recovery
app.get("/rss/status/:code", (req, res) => {
  const code = Number(req.params.code) || 500;
  res.status(code).type("application/rss+xml").send(buildRssFeed());
});

// 302 redirect 到指定 URL，用於測試 redirect 處理與 SSRF 防護
app.get("/rss/redirect", (req, res) => {
  const to = req.query.to;

  if (!to) {
    return res.status(400).json({ message: "to 為必填查詢參數" });
  }

  return res.redirect(302, to);
});

app.get("/rss/redirect-loop/a", (req, res) => {
  res.redirect(302, "/rss/redirect-loop/b");
});

app.get("/rss/redirect-loop/b", (req, res) => {
  res.redirect(302, "/rss/redirect-loop/a");
});

app.listen(PORT, () => {
  console.log(`RSS test server listening on http://localhost:${PORT}`);
  console.log(`Feed: http://localhost:${PORT}/feed.xml`);
});
