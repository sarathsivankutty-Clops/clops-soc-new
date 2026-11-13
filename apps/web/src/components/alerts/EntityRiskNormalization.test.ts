import { describe, expect, it } from 'vitest';
import { normalizeEntityRiskRecord } from '@/lib/api';

describe('normalizeEntityRiskRecord', () => {
  it('normalizes real backend Fusion schema (severities, contributors, promoted_at)', () => {
    const rawFromFusion = {
      tenant_id: '00000000-0000-0000-0000-000000000001',
      entity_type: 'user',
      entity_value: 'Deepthi_KU',
      score: 144.87,
      alert_count: 21,
      last_seen: '2026-11-13T11:22:37.601150Z',
      contributing_alerts: ['alert-1', 'alert-2'],
      severities: {
        low: 6,
        high: 2,
        medium: 13,
      },
      promoted_at: '2026-11-13T10:46:19.943480Z',
      contributors: [
        {
          alert_id: 'alert-1',
          severity: 'low',
          detection: 'ListAccessKeys',
          points: 3.0,
          at: '2026-11-13T09:54:04Z',
        },
      ],
    };

    const record = normalizeEntityRiskRecord(rawFromFusion, 80);

    // severity_histogram must have critical, high, medium, low, info numbers
    expect(record.severity_histogram).toEqual({
      critical: 0,
      high: 2,
      medium: 13,
      low: 6,
      info: 0,
    });
    expect(record.threshold).toBe(80);
    expect(record.promoted).toBe(true);
    expect(record.display_score).toBe(145);
    expect(record.contributions).toHaveLength(1);
    expect(record.contributions[0]).toEqual({
      alert_id: 'alert-1',
      severity: 'low',
      raw_points: 3.0,
      observed_at: '2026-11-13T09:54:04Z',
      title: 'ListAccessKeys',
      source: null,
    });
  });

  it('handles empty or malformed objects gracefully without throwing', () => {
    const record = normalizeEntityRiskRecord(null);
    expect(record.severity_histogram.critical).toBe(0);
    expect(record.threshold).toBe(80);
    expect(record.promoted).toBe(false);
    expect(record.contributions).toEqual([]);
    expect(record.score).toBe(0);
  });
});
