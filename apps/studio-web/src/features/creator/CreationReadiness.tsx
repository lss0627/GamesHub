'use client';
import { useEffect, useState } from 'react';
import './creation-readiness.css';

export type CreationState = { chatReady: boolean; createReady: boolean };
type Health = {
  status?: string;
  creationReady?: boolean;
  executionMode?: string;
  dataPlane?: {
    postgres?: { status?: string };
    objectStorage?: { status?: string };
  };
  services?: {
    model?: { status?: string };
    images?: {
      status?: string;
      provider?: string;
      model?: string;
      optional?: boolean;
      configurationOnly?: boolean;
      builtinAvailable?: boolean;
    };
    unity?: { status?: string; code?: string };
  };
};
const unityHelp: Record<string, string> = {
  UNITY_EDITOR_NOT_FOUND: 'Unity制作引擎还没安装。',
  UNITY_WEB_MODULE_NOT_FOUND: '网页导出组件还没准备好。',
  UNITY_TEMPLATE_NOT_FOUND: '游戏工程模板还没准备好。',
};
export function CreationReadiness({
  onState,
}: {
  onState?: (value: CreationState) => void;
}) {
  const [health, setHealth] = useState<Health>();
  const [checked, setChecked] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A manual retry deliberately restarts the poll and cancels stale responses.
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let value: Health | undefined;
      try {
        const response = await fetch('/api/gamerhub/health', {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        const result = await response.json();
        if (
          result &&
          typeof result === 'object' &&
          result.services &&
          result.dataPlane
        )
          value = result;
      } catch {
        /* The setup card gives a stable recovery action. */
      }
      if (disposed) return;
      setHealth(value);
      setChecked(true);
      const storageReady =
        value?.dataPlane?.postgres?.status === 'ready' &&
        value?.dataPlane?.objectStorage?.status === 'ready';
      const chatReady = Boolean(
        storageReady && value?.services?.model?.status === 'ready',
      );
      onState?.({
        chatReady,
        createReady: Boolean(
          chatReady &&
            value?.executionMode === 'real-unity' &&
            value?.services?.unity?.status === 'ready' &&
            value?.creationReady !== false,
        ),
      });
      timer = setTimeout(poll, 8000);
    };
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [attempt, onState]);
  const storageReady =
    health?.dataPlane?.postgres?.status === 'ready' &&
    health?.dataPlane?.objectStorage?.status === 'ready';
  const modelReady = health?.services?.model?.status === 'ready';
  const unityReady =
    health?.executionMode === 'real-unity' &&
    health.services?.unity?.status === 'ready';
  const ready = Boolean(
    storageReady && modelReady && unityReady && health?.creationReady !== false,
  );
  const images = health?.services?.images;
  const imageLabel = [images?.provider, images?.model]
    .filter(Boolean)
    .join(' · ');
  return (
    <section
      className={`creation-readiness ${ready ? 'is-ready' : 'needs-setup'}`}
      aria-label="创作环境"
    >
      <div className="creation-readiness-heading">
        <strong>
          {!checked
            ? '正在检查创作环境…'
            : !health
              ? '创作服务还没连接上'
              : ready
                ? '创作环境已连接'
                : '再准备一下，就能开始制作'}
        </strong>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          重新检查环境
        </button>
      </div>
      {checked && !ready && (
        <div role="status">
          {!health ? (
            <p>
              回到项目文件夹，双击「启动GamerHub.cmd」。它会自动启动服务，再回来点“重新检查环境”。
            </p>
          ) : (
            <>
              {!modelReady && (
                <p>
                  AI对话还没有配置好。请完成项目的模型配置；不要把密钥发到聊天里。
                </p>
              )}
              {!storageReady && (
                <p>
                  项目存储尚未连接。请双击「启动GamerHub.cmd」重新准备，已有项目会保留。
                </p>
              )}
              {!unityReady && (
                <p>
                  {unityHelp[health.services?.unity?.code ?? ''] ??
                    '真实Unity制作环境还没准备好。'}
                  双击「启动GamerHub.cmd」自动检测和补齐组件，准备好后重新启动服务。可以先讨论玩法。
                </p>
              )}
            </>
          )}
        </div>
      )}
      {health && (
        <details>
          <summary>查看准备情况</summary>
          <ul>
            <li>AI对话：{modelReady ? '已配置，发送时连接' : '需要配置'}</li>
            <li>游戏制作：{unityReady ? 'Unity组件已找到' : '需要准备'}</li>
            <li>项目保存：{storageReady ? '可用' : '等待连接'}</li>
            <li>
              外部生图（可选）：
              {images?.status === 'ready'
                ? `${imageLabel || '图片生成服务'} · 配置已检测，尚未验证连接`
                : images?.status === 'blocked'
                  ? '配置需检查，可先使用内置素材'
                  : '未配置，可先使用内置素材'}
            </li>
          </ul>
          <p>生图模型用于生成新的图片；使用内置素材也能完成制作和试玩。</p>
          <p>
            Unity会在首次制作时检查许可。若提示未激活，请在Unity
            Hub登录并完成许可设置；你无需手动建工程、导入素材或操作编辑器。
          </p>
        </details>
      )}
    </section>
  );
}
