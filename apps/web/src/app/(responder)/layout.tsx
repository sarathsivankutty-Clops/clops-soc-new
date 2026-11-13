import type { Metadata, Viewport } from 'next';
import { ResponderShell } from '@/components/responder/ResponderShell';

export const metadata: Metadata = {
  title: {
    /* [HIDDEN-UI THEME-7 prior titles used AiSOC] */
    default: 'Responder | ClopsSOC',
    template: '%s | ClopsSOC Responder',
  },
  /* [HIDDEN-UI THEME-7 prior description named AiSOC]
  description:
    'Mobile-first AiSOC responder. Triage alerts, approve agent actions, page on-call — all from your phone.',
  */
  description:
    'Mobile-first ClopsSOC responder. Triage alerts, approve agent actions, page on-call — all from your phone.',
};

export const viewport: Viewport = {
  themeColor: '#0a0d14',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function ResponderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ResponderShell>{children}</ResponderShell>;
}
