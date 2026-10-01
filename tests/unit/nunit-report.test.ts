import { expect, it } from 'vitest';
import { parseNUnitReport } from '../../packages/unity-adapter/src/batchmode/nunit-report';

it('rejects unclosed test-case elements rather than counting them as completed evidence', () => {
  expect(() =>
    parseNUnitReport(
      '<test-run result="Passed" passed="1" failed="0"><test-case fullname="Tests.One" name="One" result="Passed"></test-run>',
    ),
  ).toThrow('UNITY_TEST_REPORT_INVALID');
});

it('retains named cases and decodes NUnit XML attributes', () => {
  const result =
    parseNUnitReport(`<test-run result="Passed" passed="2" failed="0">
    <test-case fullname="GamerHub.Generated.rewardTests.Acceptance_01_AddsTwenty" name="Acceptance_01_AddsTwenty" result="Passed" duration="0.125" />
    <test-case fullname="GamerHub.Generated.rewardTests.Acceptance_02_Pause(&quot;暂停&quot;)" name="Acceptance_02_Pause(&quot;暂停&quot;)" result="Passed" duration="0.05" />
    </test-run>`);
  expect(result).toMatchObject({ passed: 2, failed: 0, result: 'Passed' });
  expect(result.cases[1]).toMatchObject({
    fullName: 'GamerHub.Generated.rewardTests.Acceptance_02_Pause("暂停")',
    result: 'Passed',
  });
});
it('does not mistake a count or failure-message text for executed cases', () => {
  expect(() =>
    parseNUnitReport(
      '<test-run result="Passed" passed="2" failed="0"></test-run>',
    ),
  ).toThrow('UNITY_TEST_REPORT_INVALID');
  const xml = `<test-run result="Failed" passed="0" failed="1"><test-case fullname="Tests.Fail" name="Fail" result="Failed"><failure><message><![CDATA[<test-case fullname="Tests.Acceptance_01" name="Acceptance_01" result="Passed" />]]></message></failure></test-case></test-run>`;
  expect(parseNUnitReport(xml).cases).toHaveLength(1);
});
it('preserves skipped/inconclusive outcomes and rejects unsafe or malformed reports', () => {
  const report = parseNUnitReport(
    '<test-run result="Inconclusive" passed="0" failed="0"><test-case fullname="Tests.Acceptance_01" name="Acceptance_01" result="Skipped" /></test-run>',
  );
  expect(report.cases[0]?.result).toBe('Skipped');
  expect(() =>
    parseNUnitReport(
      '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]><test-run passed="0" failed="0" result="Passed"></test-run>',
    ),
  ).toThrow('UNITY_TEST_REPORT_INVALID');
  expect(() =>
    parseNUnitReport(
      '<test-run result="Passed" passed="NaN" failed="0"></test-run>',
    ),
  ).toThrow('UNITY_TEST_REPORT_INVALID');
});
