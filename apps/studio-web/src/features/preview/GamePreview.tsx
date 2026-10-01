import { useEffect, useState } from 'react';
import { UiIcon } from '../../components/UiIcon';
import { previewSandbox } from './preview-sandbox';

export function GamePreview(props: {
  status: 'empty' | 'loading' | 'ready' | 'error';
  previewUrl?: string;
  error?: string;
}) {
  const [applicationOrigin, setApplicationOrigin] = useState<string>();
  useEffect(() => setApplicationOrigin(window.location.origin), []);
  if (props.status === 'empty')
    return (
      <section className="game-preview" aria-label="游戏预览">
        <div className="game-preview__empty">
          <span className="preview-emblem">
            <UiIcon name="gamepad" />
          </span>
          <span className="game-preview__label">Viewport standby</span>
          <strong>等待你的第一个世界</strong>
          <p>提交创意后，经过构建与检查的 Unity Preview 将在这里启动。</p>
        </div>
      </section>
    );
  if (
    props.status === 'loading' ||
    (props.status === 'ready' && !applicationOrigin)
  )
    return (
      <section className="game-preview" aria-label="游戏预览">
        <span className="game-preview__scanner" aria-hidden="true" />
        <div className="game-preview__loading">
          <span className="preview-emblem">
            <UiIcon name="cube" />
          </span>
          <span className="game-preview__label">Compiling world</span>
          <strong>正在构建游戏空间</strong>
          <p>
            智能代理正在规划、生成与验证你的玩法，稍后重新打开项目也能继续查看进度。
          </p>
        </div>
      </section>
    );
  if (props.status === 'error')
    return (
      <section className="game-preview" aria-label="游戏预览" role="alert">
        <div className="game-preview__error">
          <span className="preview-emblem">
            <UiIcon name="activity" />
          </span>
          <span className="game-preview__label">Runtime interrupted</span>
          <strong>预览暂时不可用</strong>
          <p>{props.error ?? '请稍后重试。'}</p>
        </div>
      </section>
    );
  return (
    <section className="game-preview" aria-label="游戏预览">
      <iframe
        title="游戏预览"
        src={props.previewUrl}
        sandbox={previewSandbox(props.previewUrl, applicationOrigin)}
        loading="lazy"
      />
    </section>
  );
}
