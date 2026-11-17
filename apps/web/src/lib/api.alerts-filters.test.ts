import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { alertsApi } from './api';

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('alertsApi.list snake_case query param mapping', () => {
  it('translates camelCase AlertFilters to snake_case query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 1, page_size: 10 }));

    await alertsApi.list({
      page: 2,
      pageSize: 10,
      severity: 'high',
      status: 'triaging',
      startTime: '2026-11-17T00:00:00Z',
      endTime: '2026-11-17T12:00:00Z',
      assignedToMe: true,
      sort: 'priority',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('10');
    expect(url.searchParams.get('pageSize')).toBeNull();
    expect(url.searchParams.get('event_since')).toBe('2026-11-17T00:00:00Z');
    expect(url.searchParams.get('event_until')).toBe('2026-11-17T12:00:00Z');
    expect(url.searchParams.get('startTime')).toBeNull();
    expect(url.searchParams.get('assigned_to_me')).toBe('true');
    expect(url.searchParams.get('sort')).toBe('priority');
  });

  it('sends sort=newest and orders rows ascending when sort=oldest is selected', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          { id: 'newer', title: 'Newer', severity: 'low', status: 'new', event_time: '2026-11-17T10:00:00Z', created_at: '2026-11-17T10:00:00Z' },
          { id: 'older', title: 'Older', severity: 'high', status: 'new', event_time: '2026-11-16T10:00:00Z', created_at: '2026-11-16T10:00:00Z' },
        ],
        total: 2,
        page: 1,
        page_size: 25,
      }),
    );

    const res = await alertsApi.list({ sort: 'oldest' });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('sort')).toBe('newest');
    expect(res.alerts.map((a) => a.id)).toEqual(['older', 'newer']);
  });

  it('sends connector_type and search and normalizes occurrence_count', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [
          { id: 'a1', title: 'Repeat', severity: 'high', status: 'new', occurrence_count: 14, created_at: '2026-11-17T10:00:00Z' },
          { id: 'a2', title: 'Single', severity: 'low', status: 'new', created_at: '2026-11-17T09:00:00Z' },
        ],
        total: 2,
        page: 1,
        page_size: 25,
      }),
    );

    const res = await alertsApi.list({ connectorType: 'aws_cloudtrail', search: 'bucket' });
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost');
    expect(url.searchParams.get('connector_type')).toBe('aws_cloudtrail');
    expect(url.searchParams.get('search')).toBe('bucket');
    expect(res.alerts[0].occurrenceCount).toBe(14);
    expect(res.alerts[1].occurrenceCount).toBe(1);
  });
});
