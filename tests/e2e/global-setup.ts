import type { FullConfig } from '@playwright/test';

export default function globalSetup(_config: FullConfig): void {
  if (!process.env.GAMERHUB_E2E_URL)
    throw new Error('GAMERHUB_E2E_URL_REQUIRED_FOR_E2E_SUITE');
}
