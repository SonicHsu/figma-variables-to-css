interface GitLabCommitParams {
  host: string;
  token: string;
  projectId: string;
  branch: string;
  filePath: string;
  content: string;
  commitMessage: string;
}

interface GitLabFileResponse {
  content: string;
  encoding: string;
}

async function getExistingFile(
  host: string,
  token: string,
  projectId: string,
  branch: string,
  filePath: string
): Promise<GitLabFileResponse | null> {
  const encodedPath = encodeURIComponent(filePath);
  const encodedProject = encodeURIComponent(projectId);
  const url = `${host}/api/v4/projects/${encodedProject}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`;

  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": token },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitLab GET file failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<GitLabFileResponse>;
}

export async function commitToGitLab(params: GitLabCommitParams): Promise<string> {
  const { host, token, projectId, branch, filePath, content, commitMessage } = params;

  const existing = await getExistingFile(host, token, projectId, branch, filePath);
  const action = existing ? "update" : "create";

  const encodedProject = encodeURIComponent(projectId);
  const url = `${host}/api/v4/projects/${encodedProject}/repository/commits`;

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

  const res = await fetch(url, {
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
