export interface SemanticPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

export interface SemanticDiff {
  changedPaths: string[];
  patch: SemanticPatchOperation[];
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function walk(
  left: unknown,
  right: unknown,
  path: string,
  output: SemanticPatchOperation[],
): void {
  if (equal(left, right)) return;
  if (
    left &&
    typeof left === 'object' &&
    !Array.isArray(left) &&
    right &&
    typeof right === 'object' &&
    !Array.isArray(right)
  ) {
    const keys = new Set([
      ...Object.keys(left as Record<string, unknown>),
      ...Object.keys(right as Record<string, unknown>),
    ]);
    for (const key of [...keys].sort()) {
      const childPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      const leftRecord = left as Record<string, unknown>;
      const rightRecord = right as Record<string, unknown>;
      if (!(key in rightRecord)) output.push({ op: 'remove', path: childPath });
      else if (!(key in leftRecord))
        output.push({
          op: 'add',
          path: childPath,
          value: structuredClone(rightRecord[key]),
        });
      else walk(leftRecord[key], rightRecord[key], childPath, output);
    }
    return;
  }
  output.push({ op: 'replace', path, value: structuredClone(right) });
}

export function semanticDiff<T>(before: T, after: T): SemanticDiff {
  const patch: SemanticPatchOperation[] = [];
  walk(before, after, '', patch);
  return { changedPaths: patch.map((operation) => operation.path), patch };
}

function decode(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

export function applySemanticPatch<T>(
  source: T,
  patch: SemanticPatchOperation[],
): T {
  const result = structuredClone(source);
  for (const operation of patch) {
    const segments = operation.path.split('/').filter(Boolean).map(decode);
    if (segments.length === 0) throw new Error('ROOT_PATCH_NOT_ALLOWED');
    if (
      segments.some((segment) =>
        ['__proto__', 'constructor', 'prototype'].includes(segment),
      )
    )
      throw new Error('PATCH_PATH_NOT_ALLOWED');
    let cursor = result as unknown as Record<string, unknown>;
    for (const segment of segments.slice(0, -1)) {
      const next = cursor[segment];
      if (!next || typeof next !== 'object')
        throw new Error(`PATCH_PATH_NOT_FOUND: ${operation.path}`);
      cursor = next as Record<string, unknown>;
    }
    const key = segments.at(-1) as string;
    if (operation.op === 'remove') delete cursor[key];
    else cursor[key] = structuredClone(operation.value);
  }
  return result;
}
