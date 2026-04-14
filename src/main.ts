import { on, showUI } from "@create-figma-plugin/utilities";

function rgbToHex(r: number, g: number, b: number, a: number): string {
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, "0");
  const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  return a < 1 ? `${hex}${toHex(a)}` : hex;
}

interface VariableResult {
  name: string;
  collection: string;
  type: string;
  value: string;
  isAlias: boolean;
  aliasName: string | null;
}

async function resolveValue(
  variable: Variable,
  modeId: string
): Promise<{ value: string; isAlias: boolean; aliasName: string | null }> {
  const rawValue = variable.valuesByMode[modeId];

  if (
    typeof rawValue === "object" &&
    rawValue !== null &&
    "type" in rawValue &&
    (rawValue as { type: string }).type === "VARIABLE_ALIAS"
  ) {
    const alias = rawValue as { type: string; id: string };
    const referenced = await figma.variables.getVariableByIdAsync(alias.id);
    if (referenced) {
      return {
        value: referenced.name,
        isAlias: true,
        aliasName: referenced.name,
      };
    }
    return { value: alias.id, isAlias: true, aliasName: null };
  }

  if (variable.resolvedType === "COLOR") {
    const c = rawValue as { r: number; g: number; b: number; a: number };
    return { value: rgbToHex(c.r, c.g, c.b, c.a), isAlias: false, aliasName: null };
  }

  return { value: String(rawValue), isAlias: false, aliasName: null };
}

// GitLab API (runs in plugin sandbox, no Mixed Content restriction)
interface GitLabCommitParams {
  host: string;
  token: string;
  projectId: string;
  branch: string;
  filePath: string;
  content: string;
  commitMessage: string;
}

function getBaseUrl(host: string): string {
  // Route HTTP GitLab hosts through local HTTPS proxy to avoid Mixed Content
  if (host.startsWith("http://")) {
    return "http://localhost:9801";
  }
  return host;
}

async function commitToGitLab(params: GitLabCommitParams): Promise<string> {
  const { host, token, projectId, branch, filePath, content, commitMessage } = params;

  const baseUrl = getBaseUrl(host);
  const encodedProject = encodeURIComponent(projectId);
  const encodedPath = encodeURIComponent(filePath);

  // Check if file exists
  const checkUrl = `${baseUrl}/api/v4/projects/${encodedProject}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const checkRes = await fetch(checkUrl, {
    headers: { "PRIVATE-TOKEN": token },
  });
  const action = checkRes.status === 404 ? "create" : "update";

  if (checkRes.status !== 404 && !checkRes.ok) {
    const text = await checkRes.text();
    throw new Error(`GitLab GET file failed (${checkRes.status}): ${text}`);
  }

  // Commit
  const commitUrl = `${baseUrl}/api/v4/projects/${encodedProject}/repository/commits`;
  const body = {
    branch,
    commit_message: commitMessage,
    actions: [
      {
        action,
        file_path: filePath,
        content,
        encoding: "text",
      },
    ],
  };

  const res = await fetch(commitUrl, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab commit failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { web_url?: string; id?: string };
  return data.web_url || data.id || "Commit created";
}

export default function bootstrap() {
  showUI({
    height: 600,
    width: 420,
  });

  on("GET_VARIABLES", async () => {
    const collections =
      await figma.variables.getLocalVariableCollectionsAsync();
    const result: VariableResult[] = [];
    const seen = new Set<string>();

    for (const collection of collections) {
      const modeId = collection.defaultModeId;

      for (const variableId of collection.variableIds) {
        const variable =
          await figma.variables.getVariableByIdAsync(variableId);
        if (!variable) continue;

        // Deduplicate by collection + variable name to avoid duplicate CSS output
        const seenKey = `${collection.name}::${variable.name}`;
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);

        const resolved = await resolveValue(variable, modeId);

        result.push({
          name: variable.name,
          collection: collection.name,
          type: variable.resolvedType,
          value: resolved.value,
          isAlias: resolved.isAlias,
          aliasName: resolved.aliasName,
        });
      }
    }

    figma.ui.postMessage({ type: "VARIABLES_RESULT", data: result });
  });

  // Settings persistence via figma.clientStorage
  const SETTINGS_KEY = "gitlab-settings";

  on("LOAD_SETTINGS", async () => {
    const saved = await figma.clientStorage.getAsync(SETTINGS_KEY);
    if (saved) {
      figma.ui.postMessage({ type: "SETTINGS_LOADED", data: saved });
    }
  });

  on("SAVE_SETTINGS", async (data: unknown) => {
    await figma.clientStorage.setAsync(SETTINGS_KEY, data);
  });

  // GitLab commit handler
  on("GITLAB_COMMIT", async (params: GitLabCommitParams) => {
    try {
      const result = await commitToGitLab(params);
      figma.ui.postMessage({ type: "COMMIT_RESULT", success: true, data: result });
    } catch (err) {
      figma.ui.postMessage({
        type: "COMMIT_RESULT",
        success: false,
        data: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
