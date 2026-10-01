import {
  createTraceContext,
  formatTraceparent,
  isSpanId,
  isTraceId,
  parseTraceparent,
} from '@gamerhub/observability';
import { describe, expect, it } from 'vitest';

describe('W3C trace context', () => {
  it('continues a valid parent trace with a new child span', () => {
    const traceId = '1234567890abcdef1234567890abcdef';
    const parentSpanId = '1234567890abcdef';
    const context = createTraceContext(`00-${traceId}-${parentSpanId}-01`);

    expect(context.traceId).toBe(traceId);
    expect(context.parentSpanId).toBe(parentSpanId);
    expect(isSpanId(context.spanId)).toBe(true);
    expect(formatTraceparent(context)).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`),
    );
  });

  it('rejects malformed or all-zero identifiers and starts a safe trace', () => {
    expect(
      parseTraceparent(
        '00-00000000000000000000000000000000-0000000000000000-01',
      ),
    ).toBeUndefined();
    const context = createTraceContext('malformed');
    expect(isTraceId(context.traceId)).toBe(true);
    expect(isSpanId(context.spanId)).toBe(true);
  });
});
