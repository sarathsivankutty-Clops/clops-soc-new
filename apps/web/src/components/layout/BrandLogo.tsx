'use client';

import type { Branding } from '@/lib/api';
import { useOptionalTheme } from '@/components/theme/ThemeProvider';
import { useBrandLogo } from '@/hooks/useBranding';

interface BrandLogoProps {
  branding: Branding;
  className: string;
  alt?: string;
}

export function BrandLogo({ branding, className, alt = branding.product_name }: BrandLogoProps) {
  const tenantLogo = useBrandLogo(branding.logo_url);
  const theme = useOptionalTheme();
  const fallbackLogo =
    theme?.resolved === 'light' ? '/brand/logo-light.png' : '/brand/logo-dark.png';

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tenantLogo ?? fallbackLogo}
      alt={alt}
      width={160}
      height={70}
      className={className}
    />
  );
}
