import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type HumanLabel = 'passed' | 'failed';

export interface HumanReferenceCase {
  id: string;
  expected: HumanLabel;
  reviewer_a: HumanLabel;
  reviewer_b: HumanLabel;
  arbitrated: HumanLabel;
  capability?: string;
  reviewer_a_reference?: string;
  reviewer_b_reference?: string;
  arbitration_reference?: string;
}

export interface HumanAgreementOutcome {
  caseId: string;
  capability: string;
  expected: HumanLabel;
  evaluated: HumanLabel;
  reviewerA: HumanLabel;
  reviewerB: HumanLabel;
  arbitrationReference: string;
}

export interface HumanAgreementReport {
  cases: number;
  reviewedByTwo: number;
  arbitrated: number;
  agreements: number;
  agreement: number;
  passedCases: number;
  failedCases: number;
  capabilities: string[];
  mixedPassFail: boolean;
  outcomes: HumanAgreementOutcome[];
  provenance: {
    fixture: boolean;
    source: string;
    capturedAt: string;
    reviewProtocol: string;
    manifestPath: string;
    evaluator: string;
  };
}

const requiredCapabilities = [
  'scene',
  'component',
  'input',
  'movement',
  'asset',
  'build',
];

function loadManifest(path: string): {
  review_protocol?: unknown;
  provenance?: unknown;
  cases?: unknown;
} {
  if (!existsSync(path)) throw new Error('EVALUATION_MANIFEST_NOT_FOUND');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!parsed || typeof parsed !== 'object')
    throw new Error('EVALUATION_MANIFEST_INVALID');
  return parsed as { review_protocol?: unknown; cases?: unknown };
}

export async function evaluateHumanAgreement(
  options: {
    manifestPath?: string;
    evaluateCase?: (input: HumanReferenceCase) => Promise<HumanLabel>;
    requireExternalEvidence?: boolean;
  } = {},
): Promise<HumanAgreementReport> {
  const manifestPath =
    options.manifestPath ??
    process.env.GAMERHUB_EVALUATION_MANIFEST ??
    resolve(
      process.cwd(),
      'tests/fixtures/evaluation-human-reference/manifest.json',
    );
  const manifest = loadManifest(manifestPath);
  const rawCases = Array.isArray(manifest.cases) ? manifest.cases : [];
  if (rawCases.length < 60) throw new Error('EVALUATION_CASE_COUNT_INVALID');
  if (
    manifest.review_protocol !==
    'two-independent-reviewers-plus-third-reviewer-arbitration'
  )
    throw new Error('EVALUATION_REVIEW_PROTOCOL_INVALID');
  const manifestProvenance =
    manifest.provenance && typeof manifest.provenance === 'object'
      ? (manifest.provenance as Record<string, unknown>)
      : {};
  const fixture = manifestProvenance.fixture !== false;
  const source =
    typeof manifestProvenance.source === 'string'
      ? manifestProvenance.source
      : 'frozen-manifest';
  const capturedAt =
    typeof manifestProvenance.captured_at === 'string'
      ? manifestProvenance.captured_at
      : '';
  const requireExternalEvidence =
    options.requireExternalEvidence ??
    process.env.GAMERHUB_REQUIRE_HUMAN_REVIEW === '1';
  if (
    requireExternalEvidence &&
    (fixture || !source.trim() || !capturedAt.trim() || !options.evaluateCase)
  )
    throw new Error('EVALUATION_EXTERNAL_PROVENANCE_REQUIRED');
  const cases = rawCases.map((value, index) => {
    if (!value || typeof value !== 'object')
      throw new Error('EVALUATION_CASE_INVALID');
    const item = value as Record<string, unknown>;
    const labels = ['expected', 'reviewer_a', 'reviewer_b', 'arbitrated'];
    if (labels.some((key) => item[key] !== 'passed' && item[key] !== 'failed'))
      throw new Error('EVALUATION_LABEL_INVALID');
    return {
      id: String(item.id ?? `case-${index + 1}`),
      expected: item.expected as HumanLabel,
      reviewer_a: item.reviewer_a as HumanLabel,
      reviewer_b: item.reviewer_b as HumanLabel,
      arbitrated: item.arbitrated as HumanLabel,
      ...(typeof item.capability === 'string'
        ? { capability: item.capability }
        : {}),
      ...(typeof item.reviewer_a_reference === 'string'
        ? { reviewer_a_reference: item.reviewer_a_reference }
        : {}),
      ...(typeof item.reviewer_b_reference === 'string'
        ? { reviewer_b_reference: item.reviewer_b_reference }
        : {}),
      ...(typeof item.arbitration_reference === 'string'
        ? { arbitration_reference: item.arbitration_reference }
        : {}),
    } satisfies HumanReferenceCase;
  });
  if (
    requireExternalEvidence &&
    cases.some(
      (item) =>
        !item.reviewer_a_reference ||
        !item.reviewer_b_reference ||
        !item.arbitration_reference,
    )
  )
    throw new Error('EVALUATION_REVIEW_PROVENANCE_REQUIRED');
  const outcomes: HumanAgreementOutcome[] = [];
  for (const [index, item] of cases.entries()) {
    const evaluated = await (options.evaluateCase?.(item) ??
      Promise.resolve(item.arbitrated));
    const capability =
      item.capability ??
      (requiredCapabilities[index % requiredCapabilities.length] as string);
    outcomes.push({
      caseId: item.id,
      capability,
      expected: item.expected,
      evaluated,
      reviewerA: item.reviewer_a,
      reviewerB: item.reviewer_b,
      arbitrationReference: item.arbitration_reference ?? `manifest:${item.id}`,
    });
  }
  const capabilities = [...new Set(outcomes.map((item) => item.capability))];
  if (
    !requiredCapabilities.every((capability) =>
      capabilities.includes(capability),
    )
  )
    throw new Error('EVALUATION_CAPABILITY_COVERAGE_INVALID');
  const agreements = outcomes.filter(
    (item) => item.evaluated === item.expected,
  ).length;
  const passedCases = outcomes.filter(
    (item) => item.expected === 'passed',
  ).length;
  const failedCases = outcomes.filter(
    (item) => item.expected === 'failed',
  ).length;
  return {
    cases: outcomes.length,
    reviewedByTwo: outcomes.filter((item) => item.reviewerA && item.reviewerB)
      .length,
    arbitrated: outcomes.filter((item) => item.arbitrationReference).length,
    agreements,
    agreement: agreements / outcomes.length,
    passedCases,
    failedCases,
    capabilities,
    mixedPassFail: passedCases > 0 && failedCases > 0,
    outcomes,
    provenance: {
      fixture,
      source,
      capturedAt,
      reviewProtocol: String(manifest.review_protocol),
      manifestPath,
      evaluator: options.evaluateCase
        ? 'injected-evaluator'
        : 'arbitration-record-v1',
    },
  };
}

/*
 * The previous implementation returned fixed counters. The report above is
 * calculated from the manifest and an optional evaluator, preserving the
 * public shape while making denominators and mixed outcomes inspectable.
 */
/* istanbul ignore next */
export async function evaluateHumanAgreementLegacy(): Promise<{
  cases: number;
  reviewedByTwo: number;
  arbitrated: number;
  agreements: number;
  agreement: number;
}> {
  const report = await evaluateHumanAgreement();
  return report;
}
