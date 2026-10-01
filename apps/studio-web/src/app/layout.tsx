import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GamerHub · AI Game Studio',
  description: '把一句灵感变成可玩的 Unity 游戏。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-backdrop" aria-hidden="true">
          <div className="app-backdrop__grid" />
          <div className="app-backdrop__glow app-backdrop__glow--cyan" />
          <div className="app-backdrop__glow app-backdrop__glow--violet" />
        </div>
        {children}
      </body>
    </html>
  );
}
