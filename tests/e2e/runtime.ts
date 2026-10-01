export function e2eUrl(): string {
  const url = process.env.GAMERHUB_E2E_URL;
  if (!url) throw new Error('GAMERHUB_E2E_URL_REQUIRED');
  return url.replace(/\/$/, '');
}
