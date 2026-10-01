import { test as base } from '@playwright/test';

export type { Page } from '@playwright/test';
export { expect } from '@playwright/test';
export const readyHealth = {
  status: 'ready',
  creationReady: true,
  executionMode: 'real-unity',
  dataPlane: {
    postgres: { status: 'ready' },
    objectStorage: { status: 'ready' },
  },
  services: {
    model: { status: 'ready' },
    unity: { status: 'ready', license: 'checked-during-build' },
  },
};
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('**/api/gamerhub/health', (route) =>
      route.fulfill({ json: readyHealth }),
    );
    await use(page);
  },
});
