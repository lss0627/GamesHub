'use client';

import type { ArtCandidate, ArtPlan } from '@gamerhub/game-spec';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { readApiResponse } from './api-response';
import {
  type ArtDraft,
  type ArtSource,
  defaultArtPrompt,
  readArtDraft,
  writeArtDraft,
} from './art-draft';
import './art-studio.css';

export type ArtView = ArtPlan & {
  applied?: ArtCandidate | null;
  resumeAvailable?: boolean;
  resumeReasonCode?: string;
  providers?: Array<{
    id: string;
    name: string;
    available: boolean;
    provider?: string;
    model?: string;
    reasonCode?: string;
    configurationOnly?: boolean;
  }>;
};
const labels = {
  cat: '角色',
  forest: '场景',
  coin: '收集物',
  stump: '对手/障碍',
};
const errors: Record<string, string> = {
  ART_CHANGED: '素材方案已更新，已重新读取，请再选择一次。',
  ART_GENERATING: '素材正在准备，完成后可以选择。',
  ART_PROVIDER_UNAVAILABLE: '尚未配置图片生成服务，可以先使用内置素材库。',
  ART_PROVIDER_CONFIG_INVALID:
    '图片服务配置不完整或不受支持，请检查服务地址、模型和密钥，也可以选择内置素材库继续。',
  ART_PROVIDER_AUTH_FAILED:
    '图片服务鉴权失败，请检查 API 密钥与模型使用权限后重试。',
  ART_PROVIDER_RATE_LIMITED:
    '图片服务请求过于频繁，请稍后重试；也请检查账户额度是否充足。',
  ART_PROVIDER_QUOTA_EXCEEDED:
    '图片服务额度不足，请检查账户余额或额度，也可以选择内置素材库继续。',
  ART_PROVIDER_REQUEST_REJECTED:
    '图片服务没有接受这次请求，请检查模型支持情况和账户额度，并调整描述后重试。',
  ART_PROVIDER_TIMEOUT:
    '图片生成等待超时，描述和原有候选已保留。请稍后重试，重试可能再次计费。',
  ART_PROVIDER_INVALID:
    '图片服务没有返回可用图片，原有候选已保留。请检查模型的图片输出能力后重试。',
  ART_PROVIDER_FAILED: '图片生成服务暂时没有完成。描述已保留，可以重试。',
  ART_PLANNER_UNAVAILABLE: '设计伙伴暂时没有回应，请重试。',
  ART_PLANNER_INVALID: '这次素材清单不完整，请重新准备。',
  ART_GENERATION_INTERRUPTED:
    '上次素材准备因服务重启中断，已保存的图片和原有候选已保留。',
  ART_GENERATION_CANCELLED: '已停止准备，原有候选仍可使用。',
  ART_RESUME_UNAVAILABLE:
    '这次准备没有可继续的记录，请按当前描述重新准备两组。',
  ART_RESUME_PROVIDER_CHANGED:
    '图片服务或模型已变化，请恢复原来的配置后继续，或按当前描述重新准备两组。',
  ART_TRANSPARENCY_REQUIRED: '生成的角色图片缺少透明背景，请重新生成。',
  ART_PNG_REQUIRED:
    '图片服务返回的格式不符合要求，请使用支持 PNG 输出的生图模型。',
  PROJECT_RUN_ACTIVE: '游戏还在制作，完成后再换素材。',
};
const providerReasons: Record<string, string> = {
  ART_PROVIDER_NOT_CONFIGURED:
    '尚未配置外部生图模型，内置素材库可直接使用，仍能完成游戏制作与试玩。',
  ART_PROVIDER_UNSUPPORTED:
    '当前图片服务类型不受支持，请选择支持的服务，或使用内置素材库继续。',
  ART_PROVIDER_URL_REQUIRED:
    '图片服务缺少服务地址，请补齐地址后刷新页面，或使用内置素材库继续。',
  ART_PROVIDER_URL_INVALID:
    '图片服务地址无效，请检查地址后刷新页面，或使用内置素材库继续。',
  ART_PROVIDER_KEY_REQUIRED:
    '图片服务缺少 API 密钥，请在服务配置中补齐后刷新页面，或使用内置素材库继续。',
  ART_PROVIDER_MODEL_REQUIRED:
    '尚未选择生图模型，请在服务配置中指定模型后刷新页面，或使用内置素材库继续。',
  ART_PROVIDER_MODEL_UNSUPPORTED:
    '当前生图模型不受支持，请更换支持的图片模型，或使用内置素材库继续。',
  ART_PROVIDER_SETTINGS_INVALID:
    '图片生成参数配置无效，请检查图片尺寸、质量等设置，或使用内置素材库继续。',
};
async function artRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return readApiResponse<T>(
    await fetch(
      url,
      body === undefined
        ? {
            cache: 'no-store',
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
              : AbortSignal.timeout(15000),
          }
        : {
            method: 'POST',
            signal: AbortSignal.timeout(150000),
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          },
    ),
    errors,
  );
}
export function ArtStudio({
  projectId,
  active,
  onSelected,
  onReview,
  onState,
}: {
  projectId?: string;
  active: boolean;
  onSelected: () => Promise<void>;
  onReview: () => void;
  onState?: (value: ArtView) => void;
}) {
  const [plan, setPlan] = useState<ArtView>();
  const [prompt, setPrompt] = useState(defaultArtPrompt);
  const [source, setSource] = useState<ArtSource>('builtin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const lock = useRef(false);
  const epoch = useRef(0);
  const currentProject = useRef(projectId);
  const currentPlan = useRef<ArtView | undefined>(undefined);
  const draftEdited = useRef(false);
  const refresh = useRef<(() => void) | undefined>(undefined);
  const base = `/v1/projects/${projectId}/art`;
  useEffect(() => {
    currentProject.current = projectId;
    epoch.current++;
    lock.current = false;
    currentPlan.current = undefined;
    setPlan(undefined);
    setBusy(false);
    setError('');
    setConnectionError('');
    let draft: ArtDraft | undefined;
    try {
      if (projectId) draft = readArtDraft(localStorage, projectId);
    } catch {
      // Accessing localStorage itself can be blocked by the browser.
    }
    draftEdited.current = draft !== undefined;
    setPrompt(draft?.prompt ?? defaultArtPrompt);
    setSource(draft?.source ?? 'builtin');
    if (!projectId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let initialized = false;
    let polling = false;
    let refreshPending = false;
    const controller = new AbortController();
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && document.visibilityState !== 'hidden') {
        timer = setTimeout(
          poll,
          currentPlan.current?.status === 'generating' ? 2500 : 10000,
        );
      }
    };
    const poll = async () => {
      clearTimeout(timer);
      if (disposed || document.visibilityState === 'hidden') return;
      if (polling) {
        refreshPending = true;
        return;
      }
      if (lock.current) {
        schedule();
        return;
      }
      polling = true;
      const observedEpoch = epoch.current;
      try {
        const value = await artRequest<ArtView>(
          `/v1/projects/${projectId}/art`,
          undefined,
          controller.signal,
        );
        if (
          !disposed &&
          !lock.current &&
          observedEpoch === epoch.current &&
          Array.isArray(value.candidates)
        ) {
          if (
            !currentPlan.current ||
            value.revision >= currentPlan.current.revision
          ) {
            currentPlan.current = value;
            setPlan(value);
          }
          setConnectionError('');
          if (!initialized && !draftEdited.current) {
            if (value.prompt) setPrompt(value.prompt);
            setSource(value.generation?.source ?? 'builtin');
          }
          initialized = true;
        }
      } catch (e) {
        if (!disposed && observedEpoch === epoch.current && !lock.current)
          setConnectionError(e instanceof Error ? e.message : '素材读取失败');
      } finally {
        polling = false;
        if (refreshPending && !disposed) {
          refreshPending = false;
          void poll();
        } else {
          schedule();
        }
      }
    };
    const onVisibility = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') void poll();
    };
    refresh.current = () => void poll();
    document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      refresh.current = undefined;
      document.removeEventListener('visibilitychange', onVisibility);
      epoch.current++;
    };
  }, [projectId]);
  useEffect(() => {
    if (
      plan &&
      plan === currentPlan.current &&
      currentProject.current === projectId
    )
      onState?.(plan);
  }, [plan, projectId, onState]);

  function editDraft(next: ArtDraft) {
    draftEdited.current = true;
    setPrompt(next.prompt);
    setSource(next.source);
    try {
      if (projectId) writeArtDraft(localStorage, projectId, next);
    } catch {
      // Input remains usable even when persistent drafts are unavailable.
    }
  }

  async function act(action: string, values: Record<string, unknown> = {}) {
    if (
      !projectId ||
      currentProject.current !== projectId ||
      !plan ||
      lock.current
    )
      return;
    if (
      action === 'generate' &&
      values.source === 'image-provider' &&
      !plan.providers?.find((provider) => provider.id === 'image-provider')
        ?.available
    ) {
      setError('图片服务当前不可用，请检查配置，或切换到内置素材库继续。');
      return;
    }
    lock.current = true;
    const actionEpoch = ++epoch.current;
    const isCurrent = () =>
      currentProject.current === projectId && epoch.current === actionEpoch;
    setBusy(true);
    setError('');
    try {
      const next = await artRequest<ArtView>(`${base}/${action}`, {
        revision: plan.revision,
        ...values,
      });
      if (!isCurrent()) return;
      const updated: ArtView = {
        ...next,
        applied:
          next.applied === undefined
            ? (currentPlan.current?.applied ?? null)
            : next.applied,
        providers: next.providers ?? currentPlan.current?.providers ?? [],
      };
      currentPlan.current = updated;
      setPlan(updated);
      setConnectionError('');
      if (action === 'select') await onSelected();
    } catch (e) {
      if (!isCurrent()) return;
      setError(e instanceof Error ? e.message : '操作没有完成，请重试。');
      await artRequest<ArtView>(base)
        .then((next) => {
          if (isCurrent()) {
            currentPlan.current = next;
            setPlan(next);
          }
        })
        .catch(() => undefined);
    } finally {
      if (isCurrent()) {
        epoch.current++;
        lock.current = false;
        setBusy(false);
        refresh.current?.();
      }
    }
  }
  const generating = plan?.status === 'generating';
  const generation = plan?.generation;
  const completed = Math.max(0, Math.min(8, generation?.completed ?? 0));
  const styleLabels: Record<string, string> = {
    day: '晨光',
    morning: '晨光',
    warm: '暖色',
    dusk: '暮色',
    night: '月夜',
  };
  const imageProvider = plan?.providers?.find(
    (provider) => provider.id === 'image-provider',
  );
  const imageProviderAvailable = imageProvider?.available === true;
  const imageProviderLabel = imageProvider
    ? [imageProvider.name, imageProvider.model].filter(Boolean).join(' · ')
    : '图片生成服务';
  const imageProviderGuidance =
    providerReasons[imageProvider?.reasonCode ?? ''] ??
    '外部生图为可选能力。请配置图片服务、模型和 API 密钥后刷新页面，或使用内置素材库继续创作。';
  // A saved image checkpoint is not a selectable, complete game art set.
  const candidates = (plan?.candidates ?? []).filter(
    (candidate) =>
      candidate.assets.length === 4 &&
      Object.keys(labels).every((role) =>
        candidate.assets.some((asset) => asset.role === role && asset.assetId),
      ),
  );
  const recent = candidates.slice(-2);
  const earlier = candidates.slice(0, -2).reverse();
  const selected = candidates.find(
    (candidate) => candidate.id === plan?.selectedCandidateId,
  );
  const candidateCard = (candidate: ArtCandidate) => (
    <article
      key={candidate.id}
      data-candidate-id={candidate.id}
      aria-label={`素材方案 ${candidate.name}`}
      className={`art-candidate ${selected?.id === candidate.id ? 'is-selected' : ''}`}
    >
      <div className="art-candidate-heading">
        <h3>
          {candidate.name}
          <small className="art-candidate-age">
            {recent.some((item) => item.id === candidate.id)
              ? '最近准备'
              : '之前的候选'}
          </small>
        </h3>
        <span>
          {candidate.source === 'builtin' ? '内置配色' : '图片生成服务'}
        </span>
      </div>
      <div className="art-candidate-images">
        {candidate.assets.map((asset) => (
          <figure key={asset.role} className={asset.role}>
            <Image
              unoptimized
              width={asset.role === 'forest' ? 1600 : 256}
              height={asset.role === 'forest' ? 1000 : 256}
              src={`/v1/projects/${projectId}/assets/${asset.assetId}/content`}
              alt={asset.name}
            />
            <figcaption>{labels[asset.role]}</figcaption>
          </figure>
        ))}
      </div>
      <div className="art-candidate-action">
        <small>
          {plan?.applied?.id === candidate.id
            ? '✓ 当前游戏正在使用'
            : selected?.id === candidate.id
              ? '已选入草案 · 等待确认制作'
              : '候选素材 · 尚未应用'}
        </small>
        <button
          type="button"
          disabled={
            busy || active || generating || selected?.id === candidate.id
          }
          onClick={() => void act('select', { candidateId: candidate.id })}
        >
          {selected?.id === candidate.id ? '已选择' : '选择这一组'}
        </button>
      </div>
    </article>
  );
  return (
    <section className="art-studio" aria-label="自动素材工作室">
      <div className="art-studio-intro">
        <span className="studio-label">你的美术搭档</span>
        <h2>你说感觉，我来准备素材。</h2>
        <p>
          不用自己找图片。先描述画风，AI
          会整理角色、场景、金币和木桩的清单，再为你准备两组成套候选。
        </p>
      </div>
      <label htmlFor="art-prompt">希望游戏看起来是什么感觉？</label>
      <textarea
        id="art-prompt"
        value={prompt}
        onChange={(e) => editDraft({ prompt: e.target.value, source })}
        disabled={busy || generating || active}
        rows={3}
        maxLength={1500}
      />
      <div className="art-source-row">
        <label htmlFor="art-source">素材来源</label>
        <select
          id="art-source"
          value={source}
          disabled={busy || generating || active}
          aria-describedby="art-provider-status"
          onChange={(e) =>
            editDraft({ prompt, source: e.target.value as ArtSource })
          }
        >
          <option value="builtin">内置素材库 · 自动配色</option>
          <option value="image-provider" disabled={!imageProviderAvailable}>
            {imageProviderLabel}
            {imageProviderAvailable ? '（配置已检测）' : '（不可用）'}
          </option>
        </select>
      </div>
      <p className="art-source-note">
        内置候选提供晨光、暮色、月夜配色，使用同一套猫咪森林造型。来源会明确标注。
      </p>
      <p id="art-provider-status" className="art-source-note" role="status">
        {imageProviderAvailable
          ? `${imageProviderLabel}：配置已检测，尚未验证连接；实际可用性将在生成时验证。`
          : imageProviderGuidance}
        {!imageProviderAvailable && source === 'image-provider'
          ? ' 当前选择的图片服务已不可用，请切换到内置素材库，或恢复配置后再生成。'
          : ''}
      </p>
      {source === 'image-provider' && (
        <p className="art-source-note" data-testid="art-generation-cost">
          本次准备 2 组 × 4 张，共发起 8
          次外部生图请求，可能产生费用。失败或重试也可能计费，请先确认账户额度。
        </p>
      )}
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
      {connectionError && (
        <p className="studio-connection" role="status">
          素材暂时未同步，正在重试。已有候选仍会保留。
        </p>
      )}
      {plan?.status === 'failed' && (
        <p className="studio-error" role="alert">
          {errors[plan.errorCode ?? ''] ??
            '这次素材准备没有完成，描述和原有候选已保留，请重试。'}
        </p>
      )}
      {plan?.status === 'failed' && generation && (
        <div className="art-resume" data-testid="art-resume">
          <p>
            已保存 {completed}/8 张图片。
            {plan.resumeAvailable
              ? '继续准备会跳过已成功保存的图片。'
              : (errors[plan.resumeReasonCode ?? ''] ??
                providerReasons[plan.resumeReasonCode ?? ''] ??
                '当前无法继续这次准备，可以按当前描述重新准备两组。')}
          </p>
          {plan.resumeAvailable && (
            <>
              <p>
                继续使用上次的原始描述和素材来源，当前输入框的修改只用于重新准备。
              </p>
              <blockquote>{plan.prompt}</blockquote>
              {generation.source === 'image-provider' && (
                <p data-testid="art-resume-cost">
                  还需准备 {8 - completed} 张外部图片，可能产生费用。
                  上次未确认完成的请求也可能已经计费。
                </p>
              )}
              <button
                type="button"
                disabled={busy || active}
                onClick={() => void act('resume')}
              >
                继续上次准备（剩余 {8 - completed} 张）
              </button>
            </>
          )}
        </div>
      )}
      {generating ? (
        <div className="studio-build" role="status" data-testid="art-progress">
          <span className="studio-spinner" />
          <div>
            <strong>
              {generation?.phase === 'planning'
                ? '正在整理素材清单…'
                : '正在准备图片…'}
              {generation ? ` 已保存 ${completed}/8 张` : ''}
            </strong>
            {generation && (
              <progress
                className="art-progress-bar"
                value={completed}
                max={8}
                aria-label="素材准备进度"
              />
            )}
            {generation?.active && (
              <p>
                正在准备：
                {styleLabels[generation.active.style] ??
                  generation.active.style}
                {' · '}
                {labels[generation.active.role]}
              </p>
            )}
            <p>可以先看其他内容，回来后会显示结果。</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act('cancel')}
          >
            停止准备
          </button>
        </div>
      ) : (
        <button
          className="studio-primary"
          type="button"
          disabled={
            !projectId ||
            !plan ||
            !prompt.trim() ||
            busy ||
            active ||
            (source === 'image-provider' && !imageProviderAvailable)
          }
          onClick={() => void act('generate', { prompt, source })}
        >
          {busy
            ? '正在保存…'
            : plan?.status === 'failed'
              ? '按当前描述重新准备两组（8 张）'
              : candidates.length
                ? '按新描述再准备两组'
                : '自动准备两组素材 →'}
        </button>
      )}
      {!projectId && (
        <p>先在左侧发送一句游戏想法，保存项目后就能自动准备素材。</p>
      )}
      {plan?.requirements.length ? (
        <div className="art-requirements">
          <h3>这款游戏需要的素材</h3>
          {plan.requirements.map((item) => (
            <p key={item.role}>
              <strong>{labels[item.role]}</strong>
              {item.description}
            </p>
          ))}
        </div>
      ) : null}
      <div className="art-candidates">{recent.map(candidateCard)}</div>
      {earlier.length > 0 && (
        <details className="art-history">
          <summary>之前的候选（{earlier.length} 组）</summary>
          <div className="art-candidates">{earlier.map(candidateCard)}</div>
        </details>
      )}
      {selected && (
        <div className="art-review">
          <p>已选「{selected.name}」。先检查制作说明，确认后才会应用到游戏。</p>
          <button
            type="button"
            className="studio-primary"
            disabled={busy || active || generating}
            onClick={onReview}
          >
            带着这组素材查看方案 →
          </button>
        </div>
      )}
      {plan?.applied && (
        <p className="art-applied">
          当前试玩使用「{plan.applied.name}」。选择新候选不会改动已有试玩。
        </p>
      )}
    </section>
  );
}
