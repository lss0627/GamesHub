export function previewSandbox(
  previewUrl?: string,
  applicationOrigin?: string,
): string {
  if (!previewUrl || !applicationOrigin) return 'allow-scripts';
  try {
    const preview = new URL(previewUrl, applicationOrigin);
    // Unity uses Cache Storage/IndexedDB. Preserve its own origin only when
    // the publisher is isolated from the Studio application's origin.
    if (
      ['http:', 'https:'].includes(preview.protocol) &&
      preview.origin !== new URL(applicationOrigin).origin
    )
      return 'allow-scripts allow-same-origin';
  } catch {
    /* Invalid URLs must never gain additional sandbox permissions. */
  }
  return 'allow-scripts';
}
