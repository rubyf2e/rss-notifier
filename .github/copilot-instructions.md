# 專案開發規則

## Stack / Structure

- `frontend/`: Nuxt 4 + Vue 3 + TypeScript，程式碼在 `frontend/app/`。
- `backend/`: NestJS 12 + TypeScript，程式碼在 `backend/src/`。
- `backend/prisma/`: Prisma schema/migrations。
- `backend/generated/prisma/`: generated client，禁止手動修改。
- `docker-compose.yml`: PostgreSQL、Redis、Backend、Frontend。

## Requirement Priority

- 當次 user request > `docs/requirements.md` > 本文件 > 現有實作。
- 現有 code 只是實作參考，不代表一定符合需求。
- 不自行增加需求或推測未定義行為。

## Before Modification

先檢查需求相關的：

- Module / Controller / Service
- DTO / Config
- Prisma / Queue / Processor / Scheduler
- Tests
- Frontend pages / components / composables / styles

優先重用現有實作；不要先重構或建立新 abstraction。

## Minimal Change

- 只修改完成需求必要的檔案。
- 不修改無關 code、API、schema、dependency、命名或格式。
- 不刪除或覆蓋既有 user changes。
- 不因「順便改善」而擴大修改範圍。
- 需求明確禁止修改的項目不得自行修改。

## Dependencies

Frontend 已使用：

- Sass / SCSS
- Tailwind CSS
- Element Plus / `@element-plus/nuxt`

除既有 dependencies 外，不自行新增 package，除非當次需求明確允許。

不修改 `package.json` / lockfile，除非當次需求涉及 dependency 變更。

## Existing Infrastructure

優先使用現有：

- Prisma / PrismaService
- ConfigService
- JWT
- Mailer / Nodemailer
- BullMQ / Redis
- NestJS Scheduler
- Nuxt / Vue composables
- Element Plus
- Tailwind CSS
- Sass / SCSS

已有 infrastructure 時，不建立第二套：

- Queue / Processor
- Mail service
- JWT implementation
- Scheduler
- DB abstraction
- Config mechanism
- CSS framework / styling system

## Backend

- 使用 NestJS module/controller/service 分層與 TypeScript strict mode。
- 外部輸入使用 DTO + `class-validator` / `class-transformer`。
- 遵循現有 global `ValidationPipe`。
- DB 存取使用 `PrismaService`。
- 不直接修改 generated Prisma client。

### Prisma

需要 schema 變更時：

1. 修改 `schema.prisma`
2. 建立 migration
3. generate client
4. 執行相關測試/build

若需求禁止 schema 變更，不得自行修改 schema。

### API

- API contract 依 requirements、Controller、DTO、Service、tests 判定。
- 不猜測 endpoint、method、payload、response。
- API contract 變更時同步更新必要的 frontend/types/tests。
- Frontend API base URL 使用 `NUXT_PUBLIC_API_BASE`，不得硬編碼。

## Frontend

- 使用 Nuxt 4、Vue 3、`<script setup lang="ts">`。
- UI component 使用 Element Plus。
- 優先沿用既有 pages、components、composables、styles。
- Layout、spacing、responsive、簡單 utility 優先使用 Tailwind CSS。
- Global styles、design tokens、Element Plus overrides、複雜/共用樣式使用 SCSS。
- 保持 SSR/client 邊界；browser API 只能在 client context 使用。
- 不把 mock 行為視為正式 API contract。

## Styling

- `.vue` 禁止使用 `<style>` / `<style scoped>`。
- 不在 `.vue` 撰寫 CSS/SCSS。
- 不使用 inline `style`，除非需求明確需要動態 inline style。
- 所有 SCSS 放在 `frontend/app/assets/scss/`。
- 全域入口為 `frontend/app/assets/scss/main.scss`，沿用 Nuxt 現有載入方式。
- 使用 Sass partials + `@use`，避免所有樣式集中在單一 SCSS。
- SCSS 依責任拆分，例如：
  - `base/`：reset、base styles
  - `layout/`：layout、container、responsive
  - `components/`：共用 component styles
  - `pages/`：page-specific styles
  - `utilities/`：必要的共用 utility
  - `variables/` / `mixins/`：design tokens、mixins
- 不因少量樣式過度拆分檔案。
- `main.scss` 只負責組合 partials，不放大量實際樣式。
- Tailwind 優先處理 layout、spacing、responsive、簡單 utility；不要為 Tailwind 已能處理的樣式建立 SCSS。
- Element Plus 優先使用 props / classes / theme variables；只有必要時才使用 SCSS override。
- 共用 styles / variables / mixins 不重複定義。
- 修改樣式時維持現有 UI 與 responsive 行為，只修改必要範圍。

## Testing

- 新增/修改功能時，測試需求中的實際行為。
- Bug fix 必須補 regression test。
- Queue：測試 enqueue、Processor payload、必要的 service 呼叫。
- Scheduler：測試執行條件與 DB operation。
- DB query：測試關鍵 `where` / query 條件。
- SMTP、Redis、第三方服務：優先 mock/spy，除非需求要求 integration test。
- 不修改測試來掩蓋錯誤實作。
- 測試註解寫中文。

## Validation

Backend 測試、lint、build 一律在 Docker Backend container 執行：

```bash
docker compose exec backend npm run lint
docker compose exec backend npm test
docker compose exec backend npm run test:e2e
docker compose exec backend npm run build
```

需要 PostgreSQL / Redis / Prisma 時，使用既有 Docker Compose services 驗證。

Frontend：

```bash
docker compose exec frontend npm run build
```

只執行實際存在的 script；不要假設不存在的 lint/typecheck script。

未執行的 test/lint/build 不得宣稱通過。

## Done

完成後簡潔回報：

1. 修改檔案
2. 實作內容
3. 執行的驗證與結果
4. 需要手動設定的事項

不要輸出長篇架構規劃；先檢查、直接做最小必要修改。
