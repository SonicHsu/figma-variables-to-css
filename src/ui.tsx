import "!./output.css";
import { render } from "@create-figma-plugin/ui";
import { emit } from "@create-figma-plugin/utilities";
import { h } from "preact";
import { useEffect, useState, useCallback } from "preact/hooks";
import { generateCSS, type FigmaVariable } from "./css-generator";

type Tab = "preview" | "settings";

interface GitLabSettings {
  host: string;
  token: string;
  projectId: string;
  branch: string;
  filePath: string;
}

const DEFAULT_SETTINGS: GitLabSettings = {
  host: "https://gitlab.com",
  token: "",
  projectId: "",
  branch: "design-tokens",
  filePath: "tokens/variables.css",
};

function Plugin() {
  const [variables, setVariables] = useState<FigmaVariable[]>([]);
  const [tab, setTab] = useState<Tab>("preview");
  const [settings, setSettings] = useState<GitLabSettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<string>("");
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (!msg) return;
      if (msg.type === "VARIABLES_RESULT") {
        setVariables(msg.data);
      }
      if (msg.type === "SETTINGS_LOADED") {
        setSettings((prev) => ({ ...prev, ...msg.data }));
      }
      if (msg.type === "COMMIT_RESULT") {
        setCommitting(false);
        if (msg.success) {
          setStatus(`Committed! ${msg.data}`);
        } else {
          setStatus(`Error: ${msg.data}`);
        }
      }
    };
    emit("GET_VARIABLES");
    emit("LOAD_SETTINGS");
  }, []);

  const cssOutput = generateCSS(variables);

  const updateSetting = useCallback(
    (key: keyof GitLabSettings, value: string) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        emit("SAVE_SETTINGS", next);
        return next;
      });
    },
    []
  );

  const handleCommit = useCallback(async () => {
    if (!settings.token || !settings.projectId) {
      setStatus("請先在 Settings 填入 GitLab Token 和專案 ID");
      return;
    }
    if (!cssOutput) {
      setStatus("沒有 variables 可以 commit");
      return;
    }

    setCommitting(true);
    setStatus("Committing...");

    emit("GITLAB_COMMIT", {
      host: settings.host,
      token: settings.token,
      projectId: settings.projectId,
      branch: settings.branch,
      filePath: settings.filePath,
      content: cssOutput,
      commitMessage: `chore: sync design tokens from Figma\n\nUpdated ${variables.length} variable(s)`,
    });
  }, [settings, cssOutput, variables.length]);

  const handleRefresh = useCallback(() => {
    setVariables([]);
    emit("GET_VARIABLES");
  }, []);

  const commitButton = (
    <div class="border-t border-gray-200 p-3 space-y-2">
      {status && (
        <p class={`text-xs break-all ${status.startsWith("Error") ? "text-red-500" : "text-green-600"}`}>
          {status}
        </p>
      )}
      <button
        style={{
          width: "100%",
          padding: "8px 0",
          borderRadius: "4px",
          backgroundColor: committing || !cssOutput ? "#93c5fd" : "#2563eb",
          color: "#fff",
          fontWeight: 500,
          fontSize: "14px",
          cursor: committing || !cssOutput ? "not-allowed" : "pointer",
          border: "none",
          opacity: committing || !cssOutput ? 0.6 : 1,
        }}
        disabled={committing || !cssOutput}
        onClick={handleCommit}
      >
        {committing ? "Committing..." : `Commit to GitLab (${settings.branch})`}
      </button>
    </div>
  );

  return (
    <div class="text-xs">
      {/* Version */}
      <div class="bg-gray-50 text-gray-400 text-center py-0.5 text-xs">v0.8.0</div>

      {/* Tab Bar */}
      <div class="flex border-b border-gray-200 bg-white">
        <button
          class={`flex-1 py-2 text-center font-medium transition-colors ${
            tab === "preview"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setTab("preview")}
        >
          Preview
        </button>
        <button
          class={`flex-1 py-2 text-center font-medium transition-colors ${
            tab === "settings"
              ? "text-blue-600 border-b-2 border-blue-600"
              : "text-gray-500 hover:text-gray-700"
          }`}
          onClick={() => setTab("settings")}
        >
          Settings
        </button>
      </div>

      {/* Content */}
      <div class="p-3">
        {tab === "preview" ? (
          <PreviewTab
            variables={variables}
            cssOutput={cssOutput}
            onRefresh={handleRefresh}
          />
        ) : (
          <SettingsTab
            settings={settings}
            onUpdate={updateSetting}
            commitButton={commitButton}
          />
        )}
      </div>
    </div>
  );
}

function PreviewTab({
  variables,
  cssOutput,
  onRefresh,
}: Readonly<{
  variables: FigmaVariable[];
  cssOutput: string;
  onRefresh: () => void;
}>) {
  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="font-bold text-sm">Variables ({variables.length})</h2>
        <button class="text-blue-600 hover:text-blue-800 text-xs" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      {variables.length === 0 ? (
        <p class="text-gray-400">No variables found. Make sure your file has local variables.</p>
      ) : (
        <div class="space-y-3">
          <ul class="space-y-1">
            {variables.map((v) => (
              <li key={v.name} class="flex items-center gap-2 py-1 border-b border-gray-100">
                {v.type === "COLOR" && !v.isAlias && (
                  <span
                    class="inline-block w-3 h-3 rounded-sm border border-gray-300 shrink-0"
                    style={{ backgroundColor: v.value }}
                  />
                )}
                <span class="font-medium truncate">{v.name}</span>
                <span class="text-gray-400 ml-auto shrink-0">
                  {v.isAlias ? `-> ${v.value}` : v.value}
                </span>
              </li>
            ))}
          </ul>

          <div>
            <h3 class="font-bold text-sm mb-1">CSS Output</h3>
            <pre class="bg-gray-50 border border-gray-200 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap">
              {cssOutput}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  settings,
  onUpdate,
  commitButton,
}: Readonly<{
  settings: GitLabSettings;
  onUpdate: (key: keyof GitLabSettings, value: string) => void;
  commitButton: preact.ComponentChildren;
}>) {
  return (
    <div class="space-y-3">
      <h2 class="font-bold text-sm">GitLab 設定</h2>

      <Field label="GitLab 網址" hint="公司自架的 GitLab 網址，或使用預設 gitlab.com">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.host}
          onInput={(e) => onUpdate("host", (e.target as HTMLInputElement).value)}
          placeholder="https://gitlab.com"
        />
      </Field>

      <Field label="Personal Access Token" hint="到 GitLab > Settings > Access Tokens 產生，需要 api 或 write_repository 權限">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          type="password"
          value={settings.token}
          onInput={(e) => onUpdate("token", (e.target as HTMLInputElement).value)}
          placeholder="glpat-xxxxxxxxxxxx"
        />
      </Field>

      <Field label="專案 ID" hint="GitLab 專案首頁 > 專案名稱下方會顯示 Project ID，或用 group/project-name 格式">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.projectId}
          onInput={(e) => onUpdate("projectId", (e.target as HTMLInputElement).value)}
          placeholder="12345 or group/project"
        />
      </Field>

      <Field label="分支名稱" hint="CSS 會 commit 到這個分支，分支必須已經存在">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.branch}
          onInput={(e) => onUpdate("branch", (e.target as HTMLInputElement).value)}
          placeholder="design-tokens"
        />
      </Field>

      <Field label="檔案路徑" hint="CSS 檔案在 repo 內的存放位置">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.filePath}
          onInput={(e) => onUpdate("filePath", (e.target as HTMLInputElement).value)}
          placeholder="tokens/variables.css"
        />
      </Field>

      {commitButton}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: Readonly<{
  label: string;
  hint?: string;
  children: preact.ComponentChildren;
}>) {
  return (
    <label class="block">
      <span class="text-xs font-medium text-gray-700">{label}</span>
      {hint && <span class="block text-xs text-gray-400 mb-1">{hint}</span>}
      {children}
    </label>
  );
}

export default render(Plugin);
