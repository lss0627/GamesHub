export interface NUnitCase {
  fullName: string;
  name: string;
  result: 'Passed' | 'Failed' | 'Skipped' | 'Inconclusive';
  durationSeconds: number;
}
export interface NUnitReport {
  result: string;
  passed: number;
  failed: number;
  cases: NUnitCase[];
}
const invalid = () => new Error('UNITY_TEST_REPORT_INVALID');
function decode(value: string) {
  return value.replace(/&([^;]+);/g, (_whole, name: string) => {
    const named: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    if (Object.hasOwn(named, name)) return named[name] as string;
    const numeric = /^#x[\da-f]+$/i.test(name)
      ? Number.parseInt(name.slice(2), 16)
      : /^#\d+$/.test(name)
        ? Number(name.slice(1))
        : NaN;
    if (
      !Number.isInteger(numeric) ||
      numeric < 1 ||
      numeric > 0x10ffff ||
      (numeric >= 0xd800 && numeric <= 0xdfff)
    )
      throw invalid();
    return String.fromCodePoint(numeric);
  });
}
function attributes(tag: string) {
  const values: Record<string, string> = Object.create(null);
  const rest = tag.replace(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    (
      _whole,
      name: string,
      double: string | undefined,
      single: string | undefined,
    ) => {
      if (Object.hasOwn(values, name)) throw invalid();
      values[name] = decode(double ?? single ?? '');
      return '';
    },
  );
  if (rest.replace(/\/\s*$/, '').trim()) throw invalid();
  return values;
}
function validateStructure(source: string) {
  const stack: string[] = [];
  let end = 0;
  let roots = 0;
  for (const tag of source.matchAll(
    /<(\/?)([A-Za-z_][\w:.-]*)((?:[^"'>]|"[^"]*"|'[^']*')*)>/g,
  )) {
    if (source.slice(end, tag.index).includes('<')) throw invalid();
    end = (tag.index ?? 0) + tag[0].length;
    const name = tag[2] ?? '';
    const body = tag[3] ?? '';
    if (tag[1]) {
      if (body.trim() || stack.pop() !== name) throw invalid();
    } else {
      attributes(body);
      if (!stack.length && (++roots !== 1 || name !== 'test-run'))
        throw invalid();
      if (
        name === 'test-case' &&
        stack.some((parent) => !['test-run', 'test-suite'].includes(parent))
      )
        throw invalid();
      if (!/\/\s*$/.test(body)) stack.push(name);
    }
  }
  if (stack.length || source.slice(end).trim() || roots !== 1) throw invalid();
}
/** Bounded reader for NUnit's attribute-based report; it never resolves XML entities or external resources. */
export function parseNUnitReport(xml: string): NUnitReport {
  if (
    Buffer.byteLength(xml) > 16 * 1024 * 1024 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml)
  )
    throw invalid();
  const source = xml.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g,
    '',
  );
  validateStructure(source);
  const root = source.match(/^\s*<test-run\b((?:[^"'>]|"[^"]*"|'[^']*')*)>/);
  if (!root?.[1] || !/<\/test-run>\s*$/.test(source)) throw invalid();
  const summary = attributes(root[1]);
  if (
    !/^\d+$/.test(summary.passed ?? '') ||
    !/^\d+$/.test(summary.failed ?? '') ||
    !['Passed', 'Failed', 'Skipped', 'Inconclusive'].includes(
      summary.result ?? '',
    )
  )
    throw invalid();
  const cases: NUnitCase[] = [];
  for (const match of source.matchAll(
    /<test-case\b((?:[^"'>]|"[^"]*"|'[^']*')*)>/g,
  )) {
    const item = attributes(match[1] ?? '');
    if (
      !item.fullname ||
      !item.name ||
      item.fullname.length > 2000 ||
      item.name.length > 1500 ||
      !['Passed', 'Failed', 'Skipped', 'Inconclusive'].includes(
        item.result ?? '',
      )
    )
      throw invalid();
    const durationSeconds = Number(item.duration ?? 0);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds < 0 ||
      cases.length >= 2000
    )
      throw invalid();
    cases.push({
      fullName: item.fullname,
      name: item.name,
      result: item.result as NUnitCase['result'],
      durationSeconds,
    });
  }
  const passed = Number(summary.passed);
  const failed = Number(summary.failed);
  if (
    cases.filter((item) => item.result === 'Passed').length !== passed ||
    cases.filter((item) => item.result === 'Failed').length !== failed
  )
    throw invalid();
  return { result: summary.result ?? 'Inconclusive', passed, failed, cases };
}
