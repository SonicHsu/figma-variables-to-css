const http = require("http");

const GITLAB_HOST = "http://10.2.11.139";
const PORT = 9801;

const server = http.createServer((req, res) => {
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
    // Copy response headers but add CORS
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
  console.log(`GitLab proxy running on http://localhost:${PORT}`);
  console.log(`Forwarding to ${GITLAB_HOST}`);
});
