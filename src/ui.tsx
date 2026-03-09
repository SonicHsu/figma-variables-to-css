import "!./output.css";
import { render } from "@create-figma-plugin/ui";
import { emit } from "@create-figma-plugin/utilities";
import { h } from "preact";
import { useEffect, useState, useCallback } from "preact/hooks";
import { generateCSS, type FigmaVariable } from "./css-generator";
import { commitToGitLab } from "./gitlab";

type Tab = "preview" | "settings";

const STORAGE_KEY = "figma-gitlab-settings";

interface GitLabSettings {
  host: string;
  token: string;
  projectId: string;
  branch: string;
  filePath: string;
}

function loadSettings(): GitLabSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as GitLabSettings;
  } catch {}
  return {
    host: "https://gitlab.com",
    token: "",
    projectId: "",
    branch: "design-tokens",
    filePath: "tokens/variables.css",
  };
}

function saveSettings(settings: GitLabSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function Plugin() {
  const [variables, setVariables] = useState<FigmaVariable[]>([]);
  const [tab, setTab] = useState<Tab>("preview");
  const [settings, setSettings] = useState<GitLabSettings>(loadSettings);
  const [status, setStatus] = useState<string>("");
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    window.onmessage = (event) => {
      const msg = event.data.pluginMessage;
      if (msg?.type === "VARIABLES_RESULT") {
        setVariables(msg.data);
      }
    };
    emit("GET_VARIABLES");
  }, []);

  const cssOutput = generateCSS(variables);

  const updateSetting = useCallback(
    (key: keyof GitLabSettings, value: string) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        saveSettings(next);
        return next;
      });
    },
    []
  );

  const handleCommit = useCallback(async () => {
    if (!settings.token || !settings.projectId) {
      setStatus("Please fill in GitLab token and project ID in Settings.");
      return;
    }
    if (!cssOutput) {
      setStatus("No variables to commit.");
      return;
    }

    setCommitting(true);
    setStatus("Committing...");

    try {
      const result = await commitToGitLab({
        host: settings.host,
        token: settings.token,
        projectId: settings.projectId,
        branch: settings.branch,
        filePath: settings.filePath,
        content: cssOutput,
        commitMessage: `chore: sync design tokens from Figma\n\nUpdated ${variables.length} variable(s)`,
      });
      setStatus(`Committed! ${result}`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCommitting(false);
    }
  }, [settings, cssOutput, variables.length]);

  const handleRefresh = useCallback(() => {
    setVariables([]);
    emit("GET_VARIABLES");
  }, []);

  return (
    <div class="flex flex-col text-xs" style={{ height: "100vh", overflow: "hidden" }}>
      {/* Version */}
      <div class="bg-gray-50 text-gray-400 text-center py-0.5 text-xs shrink-0">v0.3.2</div>
      {/* Tab Bar */}
      <div class="flex border-b border-gray-200 bg-white shrink-0">
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
      <div class="flex-1 overflow-y-auto p-3" style={{ minHeight: 0 }}>
        {tab === "preview" ? (
          <PreviewTab
            variables={variables}
            cssOutput={cssOutput}
            onRefresh={handleRefresh}
          />
        ) : (
          <SettingsTab settings={settings} onUpdate={updateSetting} />
        )}
      </div>

      {/* Bottom Bar */}
      <div class="shrink-0 border-t border-gray-200 bg-white p-3 space-y-2">
        {status && (
          <p
            class={`text-xs break-all ${
              status.startsWith("Error") ? "text-red-500" : "text-green-600"
            }`}
          >
            {status}
          </p>
        )}
        <button
          class="w-full py-2 rounded text-white font-medium text-sm transition-colors disabled:opacity-50 bg-blue-600 hover:bg-blue-700 disabled:hover:bg-blue-600"
          disabled={committing || !cssOutput}
          onClick={handleCommit}
        >
          {committing ? "Committing..." : `Commit to GitLab (${settings.branch})`}
        </button>
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
    <div class="flex h-full flex-col" style={{ minHeight: 0 }}>
      <div class="flex items-center justify-between shrink-0">
        <h2 class="font-bold text-sm">
          Variables ({variables.length})
        </h2>
        <button
          class="text-blue-600 hover:text-blue-800 text-xs"
          onClick={onRefresh}
        >
          Refresh
        </button>
      </div>

      {variables.length === 0 ? (
        <p class="mt-3 text-gray-400">No variables found. Make sure your file has local variables.</p>
      ) : (
        <div class="mt-3 flex flex-1 flex-col space-y-3" style={{ minHeight: 0 }}>
          <ul class="space-y-1 overflow-y-auto" style={{ maxHeight: "30vh" }}>
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

          <div class="flex flex-1 flex-col" style={{ minHeight: 0 }}>
            <h3 class="font-bold text-sm mb-1 shrink-0">CSS Output</h3>
            <pre
              class="bg-gray-50 border border-gray-200 rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap"
              style={{ flex: 1, minHeight: 120, overflowY: "auto" }}
            >
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
}: Readonly<{
  settings: GitLabSettings;
  onUpdate: (key: keyof GitLabSettings, value: string) => void;
}>) {
  return (
    <div class="space-y-3">
      <h2 class="font-bold text-sm">\u0047\u0069\u0074\u004c\u0061\u0062\u0020\u8a2d\u5b9a</h2>

      <Field label="\u0047\u0069\u0074\u004c\u0061\u0062\u0020\u7db2\u5740" hint="公司自架的 \u0047\u0069\u0074\u004c\u0061\u0062\u0020\u7db2\u5740，或使用預設 gitlab.com">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.host}
          onInput={(e) => onUpdate("host", (e.target as HTMLInputElement).value)}
          placeholder="https://gitlab.com"
        />
      </Field>

      <Field label="Personal Access Token" hint="\u5230\u0020\u0047\u0069\u0074\u004c\u0061\u0062\u0020\u003e\u0020\u0053\u0065\u0074\u0074\u0069\u006e\u0067\u0073\u0020\u003e\u0020\u0041\u0063\u0063\u0065\u0073\u0073\u0020\u0054\u006f\u006b\u0065\u006e\u0073\u0020\u7522\u751f\uff0c\u9700\u8981\u0020\u0061\u0070\u0069\u0020\u6216\u0020\u0077\u0072\u0069\u0074\u0065\u005f\u0072\u0065\u0070\u006f\u0073\u0069\u0074\u006f\u0072\u0079\u0020\u6b0a\u9650">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          type="password"
          value={settings.token}
          onInput={(e) => onUpdate("token", (e.target as HTMLInputElement).value)}
          placeholder="glpat-xxxxxxxxxxxx"
        />
      </Field>

      <Field label="\u5c08\u6848\u0020\u0049\u0044" hint="\u0047\u0069\u0074\u004c\u0061\u0062\u0020\u5c08\u6848\u9996\u9801\u53ef\u770b\u5230\u6578\u5b57\u0020\u0049\u0044\uff0c\u6216\u4f7f\u7528\u0020\u0067\u0072\u006f\u0075\u0070\u002f\u0070\u0072\u006f\u006a\u0065\u0063\u0074\u002d\u006e\u0061\u006d\u0065\u0020\u683c\u5f0f">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.projectId}
          onInput={(e) => onUpdate("projectId", (e.target as HTMLInputElement).value)}
          placeholder="12345 or group/project"
        />
      </Field>

      <Field label="\u5206\u652f\u540d\u7a31" hint="\u0043\u0053\u0053\u0020\u6703\u0020\u0063\u006f\u006d\u006d\u0069\u0074\u0020\u5230\u9019\u500b\u5206\u652f\uff0c\u5206\u652f\u5fc5\u9808\u5df2\u7d93\u5b58\u5728">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.branch}
          onInput={(e) => onUpdate("branch", (e.target as HTMLInputElement).value)}
          placeholder="design-tokens"
        />
      </Field>

      <Field label="\u6a94\u6848\u8def\u5f91" hint="\u0043\u0053\u0053\u0020\u6a94\u6848\u5728\u0020\u0072\u0065\u0070\u006f\u0020\u5167\u7684\u5b58\u653e\u4f4d\u7f6e">
        <input
          class="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={settings.filePath}
          onInput={(e) => onUpdate("filePath", (e.target as HTMLInputElement).value)}
          placeholder="tokens/variables.css"
        />
      </Field>
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




