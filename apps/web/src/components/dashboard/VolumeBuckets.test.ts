import { describe, expect, it } from 'vitest';
import { buildVolumeBuckets } from './DashboardView';

// 2026-11-24T12:30:00Z, the time of the EC2 payload this was written against.
const NOW = Date.UTC(2026, 10, 24, 12, 30);

describe('buildVolumeBuckets', () => {
  it('lays out every hour of the 24h window, not just the hours with alerts', () => {
    const buckets = buildVolumeBuckets(
      [
        { timestamp: '2026-11-23T13:00:00+00:00', count: 1, severity: 'low' },
        { timestamp: '2026-11-23T15:00:00+00:00', count: 1, severity: 'high' },
        { timestamp: '2026-11-24T12:00:00+00:00', count: 2, severity: 'medium' },
      ],
      '24h',
      NOW,
    );

    expect(buckets).toHaveLength(25);
    expect(buckets.filter((b) => b.total > 0)).toHaveLength(3);
    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(4);
    expect(buckets[buckets.length - 1].counts.medium).toBe(2);
  });

  it.each([
    ['1h', 61],
    ['24h', 25],
    ['7d', 8],
    ['30d', 31],
  ] as const)('%s window has %i equal slots', (window, slots) => {
    expect(buildVolumeBuckets([], window, NOW)).toHaveLength(slots);
  });

  it('drops points outside the window and keeps unknown severities', () => {
    const buckets = buildVolumeBuckets(
      [
        { timestamp: '2026-11-01T00:00:00+00:00', count: 9, severity: 'low' },
        { timestamp: '2026-11-24T12:00:00+00:00', count: 3, severity: 'weird' },
      ],
      '24h',
      NOW,
    );

    expect(buckets.reduce((n, b) => n + b.total, 0)).toBe(3);
    expect(buckets[buckets.length - 1].counts.unspecified).toBe(3);
  });
});
