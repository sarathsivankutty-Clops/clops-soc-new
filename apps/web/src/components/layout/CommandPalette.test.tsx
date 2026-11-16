/**
 * The command palette advertised `ESC` and did not honour it.
 *
 * Every console page mounts `CommandPalette` once in `AppShell`, so a modal
 * that ignores Escape affected every route at once. This is a keyboard trap in
 * the WCAG 2.1.2 sense: without Escape, dismissing the dialog required a
 * pointer, either on the backdrop or by choosing an item.
 *
 * `cmdk@1.1.1` has no Escape handling of its own — there is no "Escape" string
 * in its published dist — so the keycap was decoration and the fix belongs in
 * this component, not in a library upgrade.
 *
 * framer-motion is stubbed to a passthrough, as in `a11y.test.tsx`: the exit
 * animation is not what these cases are about, and in jsdom it delays
 * unmounting past the assertion.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// jsdom ships no layout, so `scrollIntoView` is missing; cmdk calls it to keep
// the active item visible.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock('framer-motion', () => {
  // Passthrough that keeps the DOM props: the dialog's `role="dialog"` and
  // `aria-modal` live on a `motion.div`, so a stub that drops props would hide
  // the very element these cases query for.
  const passthrough = ({
    children,
    initial: _initial,
    animate: _animate,
    exit: _exit,
    transition: _transition,
    ...rest
  }: Record<string, unknown> & { children?: React.ReactNode }) => <div {...rest}>{children}</div>;
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion: new Proxy({}, { get: () => passthrough }),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  authApi: { currentUser: () => ({ role: 'admin', tenant_id: 't1' }) },
}));

import { CommandPalette } from './CommandPalette';

function openPalette() {
  render(<CommandPalette />);
  act(() => {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  });
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
}

describe('CommandPalette dismissal', () => {
  it('closes on Escape, the key it tells the user to press', () => {
    openPalette();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('closes on Escape while the search field holds focus', () => {
    // The realistic case: the input is autofocused, so the key originates
    // inside the dialog rather than on `document` at large.
    openPalette();
    const input = screen.getByPlaceholderText(/Type a command/i);
    input.focus();

    act(() => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('keeps the backdrop as a named, clickable close control', () => {
    // The bug report described this backdrop as an invisible trap. It is not:
    // it is an opaque scrim with an accessible name, and it is the pointer
    // route out. Only the keyboard route was missing, and this guards against
    // the fix regressing the one that worked.
    openPalette();

    const backdrop = screen.getByRole('button', { name: /Close command palette/i });
    act(() => {
      fireEvent.click(backdrop);
    });

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('leaves other keys alone', () => {
    openPalette();

    act(() => {
      fireEvent.keyDown(document, { key: 'a' });
    });

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
  });
});
