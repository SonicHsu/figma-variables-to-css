# Figma Variables to CSS

Figma plugin，將 Figma Variables 自動轉換為 CSS custom properties，並直接 commit 到 GitLab 專案分支，讓設計師和工程師無縫協作 design tokens。

## 功能

- **讀取 Figma Variables** — 自動讀取目前檔案中的所有 local variables（顏色、數值、字串等）
- **CSS 轉換** — 將 variables 轉為 `:root` CSS custom properties，支援 alias 解析（`var(--xxx)`）
- **Typography 群組** — 自動偵測 typescale 結構（font / weight / size / line-height / letter-spacing），輸出為 CSS class
- **GitLab Commit** — 一鍵將產出的 CSS 透過 GitLab API commit 到指定分支
- **Settings 持久化** — GitLab 設定儲存在 Figma clientStorage，不需重複輸入

## 工作流程

```
設計師 (Figma)                           工程師 (Code)
    │                                        │
    ├─ 定義 / 修改 Variables                  │
    ├─ 開啟 Plugin → Preview tab             │
    ├─ 確認 CSS output                       │
    ├─ 點選 "Commit to GitLab"  ─────────►   │
    │                                        ├─ 收到 MR / 分支更新通知
    │                                        ├─ Review CSS 變更
    │                                        └─ Merge 到主分支
```

## 架構

```
src/
├── main.ts          # Plugin sandbox (Figma API、GitLab commit 邏輯)
├── ui.tsx           # Plugin UI (Preact + Tailwind CSS)
├── css-generator.ts # Figma Variables → CSS 轉換引擎
├── gitlab.ts        # GitLab API 模組 (備用，目前未使用)
├── input.css        # Tailwind CSS 入口
└── output.css       # Tailwind CSS 編譯產出

proxy/
└── server.js        # HTTP → GitLab 代理伺服器 (解決 Mixed Content 問題)
```

## 開發指南

### 前置需求

- [Node.js](https://nodejs.org) v22+
- [pnpm](https://pnpm.io/)
- [Figma desktop app](https://figma.com/downloads/)

### 安裝與建置

```bash
# 安裝依賴
pnpm install

# 建置 plugin (CSS + JS)
pnpm run build

# 開發模式 (watch)
pnpm run watch
```

### 安裝 Plugin 到 Figma

1. 在 Figma desktop app 開啟任一檔案
2. 透過 Quick Actions 搜尋並執行 `Import plugin from manifest…`
3. 選擇建置產生的 `manifest.json`

### 代理伺服器 (自架 HTTP GitLab 時需要)

如果你的 GitLab 是 HTTP（非 HTTPS），Figma plugin 會因為 Mixed Content 限制無法直接呼叫。需要啟動本地代理：

```bash
# 預設代理 http://10.2.11.139 → localhost:9801
pnpm run proxy

# 使用自訂 GitLab host
GITLAB_HOST=http://your-gitlab-host node proxy/server.js
```

Plugin 會自動偵測 `http://` 開頭的 GitLab 網址，將請求轉送到 `localhost:9801`。

## GitLab 設定

在 Plugin 的 **Settings** tab 填入以下資訊：

| 欄位 | 說明 | 範例 |
|------|------|------|
| GitLab 網址 | 公司 GitLab 或 gitlab.com | `https://gitlab.com` |
| Personal Access Token | 需要 `api` 或 `write_repository` 權限 | `glpat-xxxxxxxxxxxx` |
| 專案 ID | Project ID 數字或 `group/project` 格式 | `12345` |
| 分支名稱 | CSS commit 的目標分支（需已存在） | `design-tokens` |
| 檔案路徑 | CSS 檔案在 repo 中的路徑 | `tokens/variables.css` |

### 取得 GitLab Token

1. 前往 GitLab → **Settings** → **Access Tokens**
2. 建立 Personal Access Token
3. 勾選 `api` 或 `write_repository` scope
4. 複製 token 貼到 Plugin Settings

## CSS 轉換規則

### 一般 Variables → CSS Custom Properties

Figma variable 名稱會轉為 kebab-case CSS variable：

```
Figma: colors/primary/500      →  --colors-primary-500: #3b82f6;
Figma: spacing/lg              →  --spacing-lg: 24;
```

Alias variable 會轉為 `var()` 參照：

```
Figma: button/bg (alias → colors/primary/500)
→  --button-bg: var(--colors-primary-500);
```

### Typography 群組 → CSS Class

當多個 variables 共享相同父路徑且 leaf name 為已知 CSS 屬性時，自動輸出為 class：

```css
/* Figma: Typescale/CH/H1/font, weight, size, line-height, letter-spacing */
.typescale-ch-h1 {
  font-family: Noto Sans TC;
  font-weight: 700;
  font-size: 32px;
  line-height: 44px;
  letter-spacing: normal;
}
```

支援的 leaf name 對應：

| Figma leaf name | CSS property |
|-----------------|-------------|
| `font` / `font-family` | `font-family` |
| `weight` / `font-weight` | `font-weight` |
| `size` / `font-size` | `font-size` |
| `line-height` / `line height` / `leading` | `line-height` |
| `letter-spacing` / `letter spacing` / `tracking` | `letter-spacing` |

## Debugging

- 使用 `console.log` 檢查值
- 在 Figma 中透過 Quick Actions 搜尋 `Show/Hide Console` 開啟開發者控制台

## 相關資源

- [Create Figma Plugin](https://yuanqing.github.io/create-figma-plugin/)
- [Figma Plugin API docs](https://figma.com/plugin-docs/)
- [GitLab Commits API](https://docs.gitlab.com/ee/api/commits.html)
