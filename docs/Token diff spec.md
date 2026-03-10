# Token Diff on Commit — 實作規格

## 背景

Figma plugin（TypeScript）會將設計 token export 成 CSS custom properties，並直接 commit 到內網 GitLab。
目前是直接覆蓋，沒有任何 diff 記錄。

目標：在每次 commit 前，自動比對新舊 CSS，將變更摘要寫入 commit message。

---

## 現有 Plugin 架構假設

- 語言：TypeScript（Figma Plugin 環境）
- 產出：單一 CSS 檔案，內容為 CSS custom properties（`--token-name: value;`）
- Commit 方式：透過 GitLab API 直接 push（Personal Access Token 或 Project Token）

---

## 需要新增的功能

### 1. Fetch 舊版 CSS from GitLab

在 commit 之前，先從 GitLab 取得目前 branch 上的舊版 CSS 檔案。

**GitLab API endpoint：**

```
GET /api/v4/projects/:projectId/repository/files/:filePath/raw?ref=:branch
```

**實作：**

```typescript
async function fetchOldCSS(config: {
  gitlabUrl: string; // e.g. http://10.2.11.139
  projectId: string; // e.g. "123" 或 "group%2Frepo"
  filePath: string; // e.g. "src/styles/tokens.css"（需 URL encode）
  branch: string; // e.g. "design/tokens"
  token: string; // Personal Access Token
}): Promise<string | null> {
  const encodedPath = encodeURIComponent(config.filePath);
  const url = `${config.gitlabUrl}/api/v4/projects/${config.projectId}/repository/files/${encodedPath}/raw?ref=${config.branch}`;

  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": config.token },
  });

  if (res.status === 404) return null; // 檔案不存在（首次 commit）
  if (!res.ok) throw new Error(`GitLab fetch failed: ${res.status}`);

  return res.text();
}
```

> **注意：** Figma plugin 的 `fetch` 需在 `ui.html` 端執行，不能在 `code.ts` 直接呼叫。若目前架構是在 sandbox 端處理 API，需確認 network call 的位置。

---

### 2. Parse CSS Custom Properties

將 CSS 字串 parse 成 key-value map，方便比對。

```typescript
function parseCSSVars(css: string): Record<string, string> {
  const regex = /--([\w-]+)\s*:\s*([^;]+);/g;
  const result: Record<string, string> = {};
  let match;
  while ((match = regex.exec(css)) !== null) {
    result[match[1]] = match[2].trim();
  }
  return result;
}
```

---

### 3. Diff 新舊 Token

```typescript
interface TokenDiff {
  added: string[];
  removed: string[];
  modified: Array<{ key: string; from: string; to: string }>;
}

function diffCSSVars(oldCSS: string | null, newCSS: string): TokenDiff {
  const oldVars = oldCSS ? parseCSSVars(oldCSS) : {};
  const newVars = parseCSSVars(newCSS);

  const added = Object.keys(newVars).filter((k) => !(k in oldVars));
  const removed = Object.keys(oldVars).filter((k) => !(k in newVars));
  const modified = Object.keys(newVars)
    .filter((k) => k in oldVars && oldVars[k] !== newVars[k])
    .map((k) => ({ key: k, from: oldVars[k], to: newVars[k] }));

  return { added, removed, modified };
}
```

---

### 4. 產生 Commit Message

```typescript
function buildCommitMessage(diff: TokenDiff): string {
  const parts: string[] = [];

  if (diff.added.length) parts.push(`➕ added: ${diff.added.join(", ")}`);

  if (diff.modified.length)
    parts.push(`✏️ modified: ${diff.modified.map((m) => m.key).join(", ")}`);

  if (diff.removed.length) parts.push(`🗑️ removed: ${diff.removed.join(", ")}`);

  if (parts.length === 0) return "chore: update tokens (no changes detected)";

  return `chore: update tokens\n\n${parts.join("\n")}`;
}
```

---

### 5. Commit 到 GitLab

**GitLab API endpoint：**

```
PUT /api/v4/projects/:projectId/repository/files/:filePath
```

```typescript
async function commitToGitLab(config: {
  gitlabUrl: string;
  projectId: string;
  filePath: string;
  branch: string;
  token: string;
  content: string;
  message: string;
  isNewFile: boolean; // 檔案不存在時用 POST，存在時用 PUT
}): Promise<void> {
  const encodedPath = encodeURIComponent(config.filePath);
  const url = `${config.gitlabUrl}/api/v4/projects/${config.projectId}/repository/files/${encodedPath}`;
  const method = config.isNewFile ? "POST" : "PUT";

  const res = await fetch(url, {
    method,
    headers: {
      "PRIVATE-TOKEN": config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      branch: config.branch,
      content: config.content,
      commit_message: config.message,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitLab commit failed: ${res.status} ${err}`);
  }
}
```

---

## 整合：完整 Export 流程

```typescript
async function exportAndCommit(newCSS: string, gitConfig: GitConfig) {
  // 1. 拿舊版
  const oldCSS = await fetchOldCSS(gitConfig);

  // 2. diff
  const diff = diffCSSVars(oldCSS, newCSS);

  // 3. 產 commit message
  const message = buildCommitMessage(diff);

  // 4. commit
  await commitToGitLab({
    ...gitConfig,
    content: newCSS,
    message,
    isNewFile: oldCSS === null,
  });
}
```

---

## GitConfig 型別

```typescript
interface GitConfig {
  gitlabUrl: string; // e.g. "http://10.2.11.139"
  projectId: string; // GitLab project ID 或 encoded namespace/repo
  filePath: string; // CSS 檔案路徑，e.g. "src/styles/tokens.css"
  branch: string; // e.g. "design/tokens"
  token: string; // PRIVATE-TOKEN
}
```

---

## 注意事項

- `filePath` 在 URL 中需要 `encodeURIComponent`（`/` → `%2F`）
- Figma plugin 的 network request 只能在 UI thread（`ui.html`）執行，sandbox（`code.ts`）無法直接 fetch
- 首次 commit（檔案不存在）時，`fetchOldCSS` 回傳 `null`，`diffCSSVars` 會把所有 token 視為 `added`
- Token 建議存在 plugin 的 `figma.clientStorage`，不要 hardcode

---

## 驗收標準

- [ ] Export 後 GitLab commit message 包含 added / modified / removed 清單
- [ ] 首次 commit 不報錯
- [ ] CSS 無變動時 message 為 `no changes detected`
- [ ] `filePath` 含斜線時不會 API 404
