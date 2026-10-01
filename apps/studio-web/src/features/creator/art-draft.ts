export type ArtSource = 'builtin' | 'image-provider';
export interface ArtDraft {
  prompt: string;
  source: ArtSource;
}

export const defaultArtPrompt =
  '想要温暖、轻松的森林画风，也想看看月色或暮色的另一种感觉。';

function draftKey(projectId: string): string {
  return `gamerhub:art-draft:v1:${encodeURIComponent(projectId)}`;
}

export function readArtDraft(
  storage: Pick<Storage, 'getItem'>,
  projectId: string,
): ArtDraft | undefined {
  try {
    const value = JSON.parse(storage.getItem(draftKey(projectId)) ?? 'null');
    if (
      value &&
      typeof value.prompt === 'string' &&
      (value.source === 'builtin' || value.source === 'image-provider')
    ) {
      return { prompt: value.prompt.slice(0, 1500), source: value.source };
    }
  } catch {
    // A blocked or damaged local store must not prevent art creation.
  }
  return undefined;
}

export function writeArtDraft(
  storage: Pick<Storage, 'setItem'>,
  projectId: string,
  draft: ArtDraft,
): void {
  try {
    storage.setItem(draftKey(projectId), JSON.stringify(draft));
  } catch {
    // Keep the current input usable when browser storage is unavailable.
  }
}
