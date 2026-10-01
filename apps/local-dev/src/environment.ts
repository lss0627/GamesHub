import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const environmentPath = fileURLToPath(
  new URL('../../../.env.local', import.meta.url),
);

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

/** Loads local-only server environment values without overwriting the shell. */
export function loadLocalEnvironment(): void {
  if (process.env.NODE_ENV === 'test' || !existsSync(environmentPath)) return;
  const lines = readFileSync(environmentPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (process.env[name] !== undefined) continue;
    process.env[name] = unquote(trimmed.slice(separator + 1));
  }
}
