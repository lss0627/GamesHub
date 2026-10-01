import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseEnvironmentFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1);
    values[name] = value;
  }
  return values;
}

export function loadEnvironmentFile(
  path = '.env.local',
  target: NodeJS.ProcessEnv = process.env,
  options: { override?: boolean } = {},
): { path: string; loaded: string[] } {
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) return { path: absolutePath, loaded: [] };
  const values = parseEnvironmentFile(readFileSync(absolutePath, 'utf8'));
  const loaded: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (options.override || target[name] === undefined) {
      target[name] = value;
      loaded.push(name);
    }
  }
  return { path: absolutePath, loaded };
}
