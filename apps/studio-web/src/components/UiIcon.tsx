import type { ReactNode } from 'react';

export type UiIconName =
  | 'activity'
  | 'arrow'
  | 'check'
  | 'chevron'
  | 'cube'
  | 'database'
  | 'gamepad'
  | 'history'
  | 'image'
  | 'pause'
  | 'play'
  | 'server'
  | 'shield'
  | 'spark'
  | 'stop'
  | 'undo'
  | 'archive'
  | 'upload';

const iconPaths: Record<UiIconName, ReactNode> = {
  activity: <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  cube: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.5 7.8 7.5 4.4 7.5-4.4M12 12.2V21" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </>
  ),
  gamepad: (
    <>
      <path d="M8.5 7h7a5.5 5.5 0 0 1 5.2 7.3l-1 3a2.4 2.4 0 0 1-4.1.8l-1.1-1.4h-5l-1.1 1.4a2.4 2.4 0 0 1-4.1-.8l-1-3A5.5 5.5 0 0 1 8.5 7Z" />
      <path d="M7 10v4M5 12h4M16.5 11.2h.01M18.5 13.2h.01" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m4 17 5-5 3 3 2-2 6 6" />
    </>
  ),
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7V5Z" />,
  server: (
    <>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 20 6v5c0 5.2-3.4 8.3-8 10-4.6-1.7-8-4.8-8-10V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  spark: (
    <>
      <path d="m12 2 1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9L12 2Z" />
      <path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  undo: (
    <>
      <path d="M9 7 4 12l5 5" />
      <path d="M5 12h9a6 6 0 0 1 6 6" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h16v13H4z" />
      <path d="M3 3h18v4H3zM9 11h6" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
};

export function UiIcon(props: { name: UiIconName; className?: string }) {
  return (
    <svg
      className={props.className ? `ui-icon ${props.className}` : 'ui-icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[props.name]}
    </svg>
  );
}
