# 部署 HTTPS Proxy（內網 GitLab）

## 為什麼需要 Proxy

Figma plugin 運行在 HTTPS 環境下，瀏覽器的 Mixed Content 政策禁止從 HTTPS 頁面發送 HTTP 請求。如果公司 GitLab 是 HTTP（例如 `http://10.2.11.139`），plugin 無法直接呼叫 GitLab API。

解法：在內網部署一個 HTTPS reverse proxy，plugin 打 HTTPS proxy，proxy 再轉發到 HTTP GitLab。

```
Figma Plugin ──HTTPS──► 內網 Proxy Server ──HTTP──► GitLab (10.2.11.139)
                        (部署一次即可)
```

## 方案選擇

| 方案 | 難度 | 說明 |
|------|------|------|
| **方案 A: Caddy** | 最簡單 | 一行指令，自動管理 SSL 憑證 |
| **方案 B: Node.js (現有 proxy)** | 簡單 | 改現有 `proxy/server.js`，需手動產生憑證 |
| **方案 C: Nginx** | 中等 | 公司已有 Nginx 的話可以直接加一個 location |

---

## 方案 A: Caddy（推薦）

Caddy 會自動產生和續期 SSL 憑證，設定最少。

### 1. 在內網 server 上安裝 Caddy

```bash
# Ubuntu/Debian
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudflare.com/content/deb/setup.deb.sh' | sudo bash
sudo apt install caddy

# CentOS/RHEL
sudo yum install yum-plugin-copr
sudo yum copr enable @caddy/caddy
sudo yum install caddy

# macOS (測試用)
brew install caddy
```

### 2. 建立 Caddyfile

```bash
sudo mkdir -p /etc/caddy
sudo vim /etc/caddy/Caddyfile
```

內容：

```caddyfile
# 用內網 IP 或 hostname
# Caddy 會自動產生自簽憑證
https://10.2.11.100:9443 {
  tls internal

  # CORS headers
  header {
    Access-Control-Allow-Origin *
    Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS"
    Access-Control-Allow-Headers "Content-Type, PRIVATE-TOKEN"
    Access-Control-Expose-Headers *
  }

  # Handle preflight
  @options method OPTIONS
  respond @options 204

  # Reverse proxy to HTTP GitLab
  reverse_proxy http://10.2.11.139 {
    header_up Host {upstream_hostport}
  }
}
```

> 把 `10.2.11.100` 換成 proxy server 自己的內網 IP，`10.2.11.139` 換成 GitLab 的 IP。

### 3. 啟動

```bash
# 前景執行（測試）
caddy run --config /etc/caddy/Caddyfile

# 背景執行（正式）
sudo systemctl enable caddy
sudo systemctl start caddy

# 確認運行
curl -k https://10.2.11.100:9443/api/v4/version
```

### 4. Plugin 設定

在 Figma plugin 的 Settings tab：

```
GitLab 網址: https://10.2.11.100:9443
```

完成，不需要再本機開 proxy。

---

## 方案 B: Node.js HTTPS Proxy

用現有的 `proxy/server.js` 改成 HTTPS 版本。

### 1. 產生自簽憑證

在 proxy server 上執行：

```bash
mkdir -p /opt/figma-gitlab-proxy/certs
cd /opt/figma-gitlab-proxy/certs

openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout server.key \
  -out server.crt \
  -subj "/CN=figma-gitlab-proxy" \
  -addext "subjectAltName=IP:10.2.11.100"
```

> 把 `10.2.11.100` 換成 proxy server 的內網 IP。`-days 3650` 表示憑證有效 10 年。

### 2. 部署 proxy

```bash
# 複製專案的 proxy 目錄到 server
scp -r proxy/ user@10.2.11.100:/opt/figma-gitlab-proxy/

# 或直接在 server 上建立檔案
```

在 server 上建立 `/opt/figma-gitlab-proxy/server.js`：

```js
const https = require("https");
const http = require("http");
const fs = require("fs");

const GITLAB_HOST = process.env.GITLAB_HOST || "http://10.2.11.139";
const PORT = process.env.PORT || 9443;

const sslOptions = {
  key: fs.readFileSync("/opt/figma-gitlab-proxy/certs/server.key"),
  cert: fs.readFileSync("/opt/figma-gitlab-proxy/certs/server.crt"),
};

const server = https.createServer(sslOptions, (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, PRIVATE-TOKEN");
  res.setHeader("Access-Control-Expose-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const targetUrl = new URL(req.url, GITLAB_HOST);

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || 80,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host },
  };

  delete options.headers["origin"];
  delete options.headers["referer"];

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    headers["access-control-allow-origin"] = "*";
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`HTTPS GitLab proxy running on https://0.0.0.0:${PORT}`);
  console.log(`Forwarding to ${GITLAB_HOST}`);
});
```

### 3. 用 systemd 設為常駐服務

```bash
sudo vim /etc/systemd/system/figma-gitlab-proxy.service
```

內容：

```ini
[Unit]
Description=Figma GitLab HTTPS Proxy
After=network.target

[Service]
Type=simple
User=nobody
Environment=GITLAB_HOST=http://10.2.11.139
Environment=PORT=9443
ExecStart=/usr/bin/node /opt/figma-gitlab-proxy/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable figma-gitlab-proxy
sudo systemctl start figma-gitlab-proxy

# 確認狀態
sudo systemctl status figma-gitlab-proxy

# 測試
curl -k https://10.2.11.100:9443/api/v4/version
```

### 4. Plugin 設定

```
GitLab 網址: https://10.2.11.100:9443
```

---

## 方案 C: Nginx

如果公司已有 Nginx，加一個 server block 即可。

### 1. 產生憑證（同方案 B 步驟 1）

### 2. Nginx 設定

```nginx
server {
    listen 9443 ssl;
    server_name _;

    ssl_certificate     /opt/figma-gitlab-proxy/certs/server.crt;
    ssl_certificate_key /opt/figma-gitlab-proxy/certs/server.key;

    # CORS
    add_header Access-Control-Allow-Origin * always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, PRIVATE-TOKEN" always;

    if ($request_method = OPTIONS) {
        return 204;
    }

    location / {
        proxy_pass http://10.2.11.139;
        proxy_set_header Host $proxy_host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 驗證

不管哪個方案，部署完後確認：

```bash
# 1. Proxy 可以連到 GitLab
curl -k https://<proxy-ip>:9443/api/v4/version

# 2. 帶 token 測試
curl -k -H "PRIVATE-TOKEN: <your-token>" \
  https://<proxy-ip>:9443/api/v4/projects/<project-id>
```

## 注意事項

- **自簽憑證**：Figma plugin sandbox 的 fetch 接受自簽憑證（不像瀏覽器會擋），所以不需要買正式憑證
- **防火牆**：確保 proxy server 的 9443 port 對 Figma 使用者的電腦開放
- **安全性**：proxy 只在內網運行，不暴露到公網，比 Cloudflare Tunnel 安全
- **憑證續期**：自簽憑證設了 10 年有效期，基本不用管；如果用 Caddy + 內網 CA 則會自動續期
