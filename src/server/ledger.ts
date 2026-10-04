// Exports each closed year to the public ledger repository on GitHub, as one
// commit through the REST API (Git Data endpoints). The commit also carries
// RULES.md and the solver, so the ledger alone is enough to continue.
//
//   LEDGER_REPO=dabaez/annual-rite-ledger
//   LEDGER_TOKEN=<fine-grained token: Contents read/write on that repo only>

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface LedgerTarget {
  repo: string;
  token: string;
  branch: string;
}

export interface LedgerFile {
  path: string;
  content: string;
}

/** Files from this repository that travel with every ledger commit. */
export const CARRIED_FILES = [
  'RULES.md',
  'solver/README.md',
  'solver/Cargo.toml',
  'solver/Cargo.lock',
  'solver/src/main.rs',
];

export function carriedFiles(root = process.cwd()): LedgerFile[] {
  return CARRIED_FILES.filter((p) => existsSync(resolve(root, p))).map((path) => ({
    path,
    content: readFileSync(resolve(root, path), 'utf8'),
  }));
}

async function gh<T>(target: LedgerTarget, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${target.repo}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${target.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'annual-rite',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Commits `files` on top of the branch head. Skips the commit if nothing changed. */
export async function publishToLedger(target: LedgerTarget, files: LedgerFile[], message: string): Promise<string | null> {
  const ref = await gh<{ object: { sha: string } }>(target, 'GET', `/git/ref/heads/${target.branch}`);
  const head = await gh<{ tree: { sha: string } }>(target, 'GET', `/git/commits/${ref.object.sha}`);
  const tree = await gh<{ sha: string }>(target, 'POST', '/git/trees', {
    base_tree: head.tree.sha,
    tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
  });
  if (tree.sha === head.tree.sha) return null;
  const commit = await gh<{ sha: string }>(target, 'POST', '/git/commits', {
    message,
    tree: tree.sha,
    parents: [ref.object.sha],
  });
  await gh(target, 'PATCH', `/git/refs/heads/${target.branch}`, { sha: commit.sha });
  return commit.sha;
}

export function ledgerJson(ledger: unknown): string {
  return JSON.stringify(ledger, null, 2) + '\n';
}
