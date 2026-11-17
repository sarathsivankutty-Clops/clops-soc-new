import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SafeMarkdown } from './SafeMarkdown';

afterEach(() => cleanup());

describe('SafeMarkdown', () => {
  it('renders headings, bold, code, lists, and GFM tables', () => {
    const md = [
      '# Incident Report',
      '',
      '## Executive Summary',
      '',
      'A **PutBucketPolicy** event hit `s3.amazonaws.com`.',
      '',
      '| Type | Value |',
      '|------|-------|',
      '| IP | `45.112.53.58` |',
      '',
      '- Containment step 1',
      '- Containment step 2',
    ].join('\n');

    render(<SafeMarkdown source={md} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Incident Report' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Executive Summary' })).toBeInTheDocument();
    expect(screen.getByText('PutBucketPolicy').tagName).toBe('STRONG');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('45.112.53.58')).toBeInTheDocument();
    expect(screen.getByText('Containment step 1')).toBeInTheDocument();
  });

  it('opens external links with rel="noopener noreferrer" and blocks javascript: URLs', () => {
    const md = [
      'See [Runbook](https://example.com/rb) and [XSS](javascript:alert(1)).',
      '',
      '<script>window.__xss = true;</script>',
    ].join('\n');

    const { container } = render(<SafeMarkdown source={md} />);
    const link = screen.getByRole('link', { name: 'Runbook' });
    expect(link).toHaveAttribute('href', 'https://example.com/rb');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');

    expect(screen.queryByRole('link', { name: 'XSS' })).toBeNull();
    expect(screen.getByText(/XSS/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
  });
});
