'use client';

import {
  assessGameCapabilities,
  buildDesignSpec,
  capabilityFor,
  type DesignDocument,
  gameCapabilities,
  initialBrief,
  presetParameterText,
} from '@gamerhub/game-spec';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { GamePreview } from '../preview/GamePreview';
import { AgentActivity } from '../runs/AgentActivity';
import { ArtStudio, type ArtView } from './ArtStudio';
import { readApiResponse } from './api-response';
import { CreationReadiness, type CreationState } from './CreationReadiness';
import { CreativeStudio } from './CreativeStudio';
import { ProjectMemory } from './ProjectMemory';
import './guided-studio.css';

type Run = {
  id: string;
  status: string;
  request_type?: 'create' | 'modify' | 'rollback';
  result_summary?: string | null;
};
type Version = {
  id: string;
  summary: string;
  status: string;
  versionNumber?: number;
};
type Asset = { id: string; name: string; importStatus: string };
const finished = new Set([
  'succeeded',
  'failed',
  'timed_out',
  'partially_succeeded',
  'cancelled',
  'rejected',
  'out_of_scope',
]);
const stages = ['一起聊想法', '确认制作说明', '制作与检查', '试玩与打磨'];
const startingChoices = [
  '我想做敌人围攻、自动攻击和升级的幸存者游戏',
  '我想做点击收集、购买强化的成长游戏',
  '我想做一个轻松的猫咪跑酷',
  '我是小白，先告诉我怎么玩',
  '我想让现有游戏更好玩',
];
const art = [
  {
    id: 'cat',
    name: '围巾橘猫',
    role: '玩家角色',
    description: '方向键移动 · 空格跳跃',
  },
  {
    id: 'forest',
    name: '晨光森林',
    role: '游戏场景',
    description: '远山、松林与草地',
  },
  { id: 'coin', name: '星星金币', role: '收集物', description: '碰到即可加分' },
  {
    id: 'stump',
    name: '森林木桩',
    role: '障碍物',
    description: '看准时机跳过去',
  },
];
const errorMessages: Record<string, string> = {
  CONTEXT_CHANGED: '你刚修改了项目记忆，请重新发送，让伙伴按最新记录继续。',
  CONTEXT_BUDGET_EXCEEDED:
    '当前制作说明和必须遵守的记录过长，请合并重复记录后再继续。',
  GAME_CAPABILITY_MISSING:
    '这份设计还有未接入的制作能力。方案已保留，请查看能力说明并继续和伙伴敲定首版范围。',
  DESIGN_CHANGED: '方案已在另一处更新，已重新加载。请查看后再操作。',
  DESIGN_BASE_CHANGED: '试玩版本已经改变，请重新生成制作说明再确认。',
  DESIGN_DISCUSS_FIRST: '先写下你的游戏想法，再生成制作说明。',
  DESIGN_MODEL_INVALID:
    '这次 AI 没有给出完整方案。你的想法还在输入框中，请重试。',
  DESIGN_MODEL_UNAVAILABLE: 'AI 暂时没有回应。你的想法还在，请稍后重试。',
  PROJECT_RUN_ACTIVE: '游戏还在制作中，完成后可以继续修改。',
  UNITY_NOT_READY:
    'Unity还没准备好。双击项目里的启动GamerHub.cmd补齐组件后，再来确认制作。',
  DESIGN_CONVERSATION_LIMIT: '这次讨论已达长度上限，请先确认当前方案。',
  ART_CHANGED: '素材选择已经改变，请重新生成制作说明再确认。',
  ART_GENERATING: '素材正在准备，完成并选择后再生成制作说明。',
};
function saveDraft(key: string, value: string) {
  try {
    if (value) localStorage.setItem(`gamerhub:draft:${key}`, value);
    else localStorage.removeItem(`gamerhub:draft:${key}`);
  } catch {
    /* Storage may be unavailable in private contexts. */
  }
}
async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(body === undefined ? 15000 : 150000),
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(key ? { 'idempotency-key': key } : {}),
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  return readApiResponse<T>(response, errorMessages);
}

export function GuidedStudio({ projectId }: { projectId?: string }) {
  const [id, setId] = useState(projectId);
  const [design, setDesign] = useState<DesignDocument>();
  const [selectedMode, setSelectedMode] = useState<'quick' | 'discuss'>();
  const creationMode = selectedMode ?? design?.creationMode ?? 'discuss';
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState<string[]>([]);
  const [artState, setArtState] = useState<ArtView>();
  const [run, setRun] = useState<Run>();
  const [preview, setPreview] = useState<string>();
  const [versions, setVersions] = useState<Version[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [panel, setPanel] = useState<'plan' | 'assets' | 'creative' | 'play'>(
    'plan',
  );
  const [hydrating, setHydrating] = useState(Boolean(projectId));
  const [license, setLicense] = useState(false);
  const [trace, setTrace] = useState('');
  const [readiness, setReadiness] = useState<CreationState>({
    chatReady: false,
    createReady: false,
  });
  const end = useRef<HTMLDivElement>(null);
  const locked = useRef(false);
  const epoch = useRef(0);
  const draftKey = id ?? 'new';
  const appliedAssets = new Set(
    artState?.applied?.assets.map((asset) => asset.assetId) ?? [],
  );
  const acceptDesign = (next: DesignDocument) =>
    setDesign((current) =>
      !current || next.revision >= current.revision ? next : current,
    );
  function rememberInput(value: string) {
    setInput(value);
    saveDraft(draftKey, value);
  }
  useEffect(() => {
    try {
      setInput(localStorage.getItem(`gamerhub:draft:${draftKey}`) ?? '');
    } catch {
      setInput('');
    }
  }, [draftKey]);
  const active = Boolean(run && !finished.has(run.status));
  const brief = design?.brief ?? initialBrief;
  const profile = capabilityFor(brief.genre ?? 'runner');
  const playingProfile = capabilityFor(design?.appliedGenre ?? 'runner');
  const referenceArt = art.map((item) => ({
    ...item,
    ...(profile.runtime === 'arena-v1'
      ? ({
          cat: { role: '玩家角色', description: '自由走位，避开追踪的敌人' },
          coin: {
            role: '经验收集物',
            description: '敌人掉落，靠近拾取，积累后选择升级',
          },
          stump: {
            role: '敌人原型图形',
            description: '追踪玩家并造成接触伤害；暂时借用内置图形',
          },
        }[item.id] ?? {})
      : profile.genre === 'clicker'
        ? {
            role: item.id === 'forest' ? '背景' : '主题图标',
            description: '用现有图形表现资源收集与成长，外观可继续调整',
          }
        : {}),
  }));
  const capabilities = assessGameCapabilities(
    design?.spec ?? buildDesignSpec(brief),
  );
  const completedDesign = Boolean(
    design?.confirmedRunId &&
      run?.id === design.confirmedRunId &&
      run.status === 'succeeded',
  );
  const stage = active
    ? 2
    : design?.confirmedRunId && run?.status === 'succeeded'
      ? 3
      : design?.spec && !design.confirmedRunId
        ? 1
        : 0;

  useEffect(() => {
    if (!id) return;
    let disposed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    function watch<T>(
      resource: string,
      label: string,
      accept: (value: T) => void,
    ) {
      const poll = async () => {
        const observedEpoch = epoch.current;
        const fresh = () =>
          !disposed && !locked.current && observedEpoch === epoch.current;
        if (!locked.current) {
          try {
            const value = await api<T>(`/v1/projects/${id}/${resource}`);
            if (fresh()) {
              accept(value);
              setConnection((current) =>
                current.filter((item) => item !== label),
              );
            }
          } catch {
            if (fresh())
              setConnection((current) => [...new Set([...current, label])]);
          }
        }
        if (!disposed) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            void poll();
          }, 2500);
          timers.add(timer);
        }
      };
      void poll();
    }
    watch<{ items: Run[] }>('runs', '制作状态暂时未同步', (value) => {
      const ordered = [...value.items].reverse();
      setRun(ordered.find((r) => !finished.has(r.status)) ?? ordered[0]);
      const playable = ordered.find(
        (r) =>
          r.status === 'succeeded' &&
          /^https?:\/\//.test(r.result_summary ?? ''),
      );
      if (playable?.result_summary) setPreview(playable.result_summary);
    });
    watch<{ items: Version[] }>('versions', '历史版本暂时未同步', (value) =>
      setVersions(value.items),
    );
    watch<{ items: Asset[] }>('assets', '素材暂时未同步', (value) =>
      setAssets(value.items),
    );
    watch<DesignDocument>('design', '对话方案暂时未同步', (next) => {
      setDesign((current) =>
        !current ||
        next.revision > current.revision ||
        next.appliedGenre !== current.appliedGenre
          ? next
          : current,
      );
      setHydrating(false);
    });
    return () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll only when an append-only message or thinking indicator is added.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [design?.messages.length, busy]);

  async function perform(label: string, operation: () => Promise<void>) {
    if (locked.current) return;
    epoch.current++;
    locked.current = true;
    setBusy(label);
    setError('');
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，请重试。');
      if (id)
        await api<DesignDocument>(`/v1/projects/${id}/design`)
          .then(acceptDesign)
          .catch(() => undefined);
    } finally {
      epoch.current++;
      locked.current = false;
      setBusy('');
    }
  }
  async function send(message = input, mode = creationMode) {
    if (
      !message.trim() ||
      !readiness.chatReady ||
      (mode === 'quick' && !readiness.createReady)
    )
      return;
    rememberInput(message);
    await perform(
      mode === 'quick' ? '正在把你的想法整理成可制作的方案…' : '伙伴正在思考…',
      async () => {
        let project = id;
        let current = design;
        if (!project) {
          const created = await api<{ id: string }>('/v1/projects', {
            name: '我的游戏创作',
          });
          project = created.id;
          saveDraft(project, message);
          saveDraft('new', '');
          setId(project);
          window.history.replaceState(null, '', `/projects/${project}`);
          current = await api<DesignDocument>(`/v1/projects/${project}/design`);
        }
        if (!current) throw new Error('项目仍在加载，请稍后重试。');
        const next = await api<DesignDocument>(
          `/v1/projects/${project}/design/messages`,
          { revision: current.revision, message, creationMode: mode },
        );
        setDesign(next);
        setInput('');
        saveDraft(project, '');
        setPanel('plan');
        if (mode === 'quick') {
          setBusy('正在整理制作说明…');
          const prepared = await api<DesignDocument>(
            `/v1/projects/${project}/design/prepare`,
            { revision: next.revision },
          );
          setDesign(prepared);
          if (
            !prepared.spec ||
            !assessGameCapabilities(prepared.spec).executable
          )
            throw new Error(errorMessages.GAME_CAPABILITY_MISSING);
          setBusy('正在安排制作…');
          await admit(project, prepared);
        }
      },
    );
  }
  async function prepare() {
    if (!id || !design) return;
    await perform('正在整理制作说明…', async () => {
      setDesign(
        await api(`/v1/projects/${id}/design/prepare`, {
          revision: design.revision,
        }),
      );
      setPanel('plan');
    });
  }
  async function confirm() {
    if (!id || !design) return;
    await perform('正在安排制作…', async () => {
      await admit(id, design);
    });
  }
  async function admit(project: string, prepared: DesignDocument) {
    const next = await api<DesignDocument>(
      `/v1/projects/${project}/design/confirm`,
      { revision: prepared.revision },
    );
    setDesign(next);
    if (next.confirmedRunId)
      setRun({ id: next.confirmedRunId, status: 'queued' });
    setPanel('play');
  }
  function downloadSpec() {
    if (!design?.markdown) return;
    const url = URL.createObjectURL(
      new Blob([design.markdown], { type: 'text/markdown;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = '游戏制作说明-spec.md';
    link.click();
    URL.revokeObjectURL(url);
  }
  async function upload(file: File) {
    if (!id || !license) return;
    await perform('正在检查素材…', async () => {
      if (file.size > 5 * 1024 * 1024)
        throw new Error('请选择 5 MB 以内的图片。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await api(`/v1/projects/${id}/assets`, {
        name: file.name,
        mime_type: file.type,
        bytes_base64: btoa(binary),
        license_text: '用户确认拥有素材使用权',
      });
      const list = await api<{ items: Asset[] }>(`/v1/projects/${id}/assets`);
      setAssets(list.items);
    });
  }
  return (
    <main className="guided-studio">
      <header className="studio-nav">
        <a href="/" className="studio-brand">
          <span>g</span> GamerHub <small>创作小屋</small>
        </a>
        <div>
          <span className="studio-save">
            {busy ||
              (hydrating
                ? '正在打开项目…'
                : connection.length
                  ? '连接不稳定，正在重新同步…'
                  : id
                    ? '对话与方案已保存'
                    : '从一个小想法开始')}
          </span>
          <a className="studio-new" href="/">
            ＋ 新创作
          </a>
        </div>
      </header>
      <div className="studio-heading">
        <div>
          <p className="studio-eyebrow">MAKE SOMETHING PLAYFUL</p>
          <h1>把想法，慢慢变成好玩的游戏。</h1>
          <p>不需要懂代码。一句话做出第一版，也可以先详细讨论。</p>
        </div>
        <span className="studio-tag">适合第一次做游戏的你</span>
      </div>
      <ol className="studio-steps" aria-label="创作步骤">
        {stages.map((name, index) => (
          <li
            key={name}
            className={
              stage === index ? 'is-current' : stage > index ? 'is-done' : ''
            }
          >
            <span>{stage > index ? '✓' : `0${index + 1}`}</span>
            {name}
          </li>
        ))}
      </ol>
      {error && (
        <div className="studio-error" role="alert">
          {error}
          <button
            type="button"
            onClick={() => setError('')}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}
      {connection.length > 0 && (
        <div className="studio-connection" role="status">
          {connection.join('；')}
          。正在自动重连，已显示的内容和未发送文字会保留。
        </div>
      )}
      <CreationReadiness onState={setReadiness} />
      {id && <ProjectMemory key={id} projectId={id} />}
      <div className="studio-columns">
        <section className="studio-chat" aria-label="与 AI 讨论游戏方案">
          <div className="studio-chat-heading">
            <span className="studio-avatar">✦</span>
            <div>
              <h2>你的游戏设计伙伴</h2>
              <p>
                {creationMode === 'quick'
                  ? '写下想法，伙伴补齐细节并开始制作'
                  : '一起想玩法，一次解决一个小问题'}
              </p>
            </div>
            <span className="studio-online">AI</span>
          </div>
          <fieldset className="studio-creation-modes">
            <legend className="sr-only">创作方式</legend>
            {(
              [
                ['quick', '一句话制作'],
                ['discuss', '详细讨论'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={creationMode === mode}
                disabled={Boolean(busy) || hydrating || active}
                onClick={() => setSelectedMode(mode)}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <div className="studio-messages" aria-live="polite">
            <article className="studio-bubble assistant">
              <span>设计伙伴</span>
              <p>
                {creationMode === 'quick'
                  ? '描述一个你想玩的游戏，点击“直接制作”即可开始。'
                  : '嗨，欢迎来到你的创作小屋！我们先做一个能轻松上手的小作品吧。'}
              </p>
              <p>
                {creationMode === 'quick'
                  ? '未提到的难度、时长和数值会采用适合入门的设置，默认使用现有素材。需要补充的能力会先说明；完成后可以试玩并继续调整。'
                  : '你想做什么样的游戏？可以从十类2D玩法开始，也可以在已有玩法上开发新的机制。我们先定核心玩法，再确认第一版范围和制作说明。'}
              </p>
            </article>
            {design?.messages.map((message, index) => (
              <article
                // biome-ignore lint/suspicious/noArrayIndexKey: Conversation messages are append-only and never reordered.
                key={`${index}-${message.role}`}
                className={`studio-bubble ${message.role}`}
              >
                <span>{message.role === 'user' ? '你' : '设计伙伴'}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {completedDesign && (
              <article className="studio-bubble assistant">
                <span>设计伙伴 · 制作完成</span>
                <p>
                  游戏已经做好并通过检查！到右边「试玩游戏」体验一下
                  {profile.name}
                  ，再告诉我操作、难度或成长节奏哪里想调整。我们可以继续讨论下一版。
                </p>
              </article>
            )}
            {busy && (
              <p className="studio-thinking" role="status">
                ✦ {busy}
              </p>
            )}
            <div ref={end} />
          </div>
          <div className="studio-composer">
            <div className="studio-choices">
              {(completedDesign
                ? [
                    '先带我了解怎么玩',
                    '我觉得太难了，怎么调整？',
                    '我想让收集金币更有成就感',
                  ]
                : (design?.choices ?? startingChoices)
              ).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={
                    Boolean(busy) || hydrating || active || !readiness.chatReady
                  }
                  onClick={() =>
                    creationMode === 'quick'
                      ? rememberInput(choice)
                      : void send(choice, 'discuss')
                  }
                >
                  {choice} ↗
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="design-message">
                和 AI 讨论你的游戏
              </label>
              <textarea
                id="design-message"
                maxLength={4000}
                value={input}
                onChange={(event) => rememberInput(event.target.value)}
                placeholder={
                  creationMode === 'quick'
                    ? '比如：做一个轻松的猫咪跑酷，跳过木桩、收集金币。'
                    : '比如：我不太会玩游戏，希望简单一点，收集金币有成就感。'
                }
                disabled={
                  Boolean(busy) || hydrating || active || !readiness.chatReady
                }
              />
              <div>
                <small>
                  {active
                    ? '正在按已确认的说明制作，完成后继续聊。'
                    : creationMode === 'quick'
                      ? '点击直接制作后，按你的想法与默认设置开始制作。'
                      : '聊天只讨论方案，确认制作说明后才会开始制作。'}
                </small>
                <button
                  className="studio-primary"
                  disabled={
                    Boolean(busy) ||
                    hydrating ||
                    active ||
                    !input.trim() ||
                    !readiness.chatReady ||
                    (creationMode === 'quick' && !readiness.createReady)
                  }
                  type="submit"
                >
                  {creationMode === 'quick' ? '直接制作 →' : '发送 ↑'}
                </button>
              </div>
            </form>
          </div>
        </section>
        <section className="studio-workbench" aria-label="我的游戏工作台">
          <nav className="studio-tabs" aria-label="工作台内容">
            {(
              [
                ['plan', '玩法与方案'],
                ['assets', '角色与素材'],
                ['creative', '场景与动效'],
                ['play', '试玩游戏'],
              ] as const
            ).map(([value, name]) => (
              <button
                key={value}
                type="button"
                aria-pressed={panel === value}
                onClick={() => setPanel(value)}
              >
                {name}
                {value === 'play' && preview ? <i /> : null}
              </button>
            ))}
          </nav>
          {panel === 'creative' &&
            (id ? (
              <CreativeStudio
                key={id}
                projectId={id}
                active={active}
                onSaved={() => {
                  void api<DesignDocument>(`/v1/projects/${id}/design`)
                    .then(acceptDesign)
                    .catch(() => undefined);
                }}
                onApplied={(next) => {
                  acceptDesign(next);
                  if (next.confirmedRunId)
                    setRun({ id: next.confirmedRunId, status: 'queued' });
                  setPanel('play');
                }}
              />
            ) : (
              <div className="studio-plan">
                <p>
                  先在左侧写下游戏想法并创建项目，就可以布置场景、动画和声音。
                </p>
              </div>
            ))}
          {panel === 'plan' && (
            <div className="studio-plan">
              <div className="studio-art-cover">
                <Image
                  unoptimized
                  width={1600}
                  height={1000}
                  loading="eager"
                  src="/runner-art/forest.png"
                  alt="温暖的森林场景素材"
                />
                <Image
                  unoptimized
                  width={256}
                  height={256}
                  className="cover-cat"
                  src="/runner-art/cat.png"
                  alt="围着绿色围巾的橘猫角色"
                />
                <span>内置美术方向 · 制作后可试玩</span>
              </div>
              <div className="studio-plan-title">
                <div className="studio-genre-options">
                  {gameCapabilities
                    .filter((item) => item.runtime)
                    .map((item) => (
                      <button
                        type="button"
                        key={item.genre}
                        disabled={
                          Boolean(busy) || active || !readiness.chatReady
                        }
                        onClick={() =>
                          rememberInput(
                            `我想做${item.name}，请先和我讨论核心玩法与第一版范围。`,
                          )
                        }
                      >
                        {item.name}
                      </button>
                    ))}
                </div>
                <span className="studio-label">
                  {design?.spec ? '已整理的制作说明' : '一起完善的方案草稿'}
                </span>
                <h2>
                  {design?.messages.length
                    ? brief.name
                    : '先选一个你想做的游戏'}
                </h2>
                <p>
                  {design?.messages.length
                    ? brief.description
                    : '可以从下面的玩法方向开始，也可以直接描述自己的创意。伙伴会先和你敲定方案。'}
                </p>
              </div>
              {preview &&
                design?.appliedGenre &&
                profile.genre !== playingProfile.genre && (
                  <p className="studio-capability-gap" role="status">
                    当前试玩是「{playingProfile.name}」。这里保留的是下一版「
                    {profile.name}」方案，确认并制作成功后才会替换试玩。
                  </p>
                )}
              <div className="studio-summary">
                <div>
                  <span>01 / 核心乐趣</span>
                  <strong>{profile.loop}</strong>
                  <p>
                    {profile.name} ·{' '}
                    {profile.runtime
                      ? '已接入制作能力'
                      : '先设计，再明确制作缺口'}
                  </p>
                </div>
                <div>
                  <span>02 / 一局体验</span>
                  <strong>
                    {brief.duration} 秒 · {brief.difficulty}
                  </strong>
                  <p>
                    {profile.genre === 'runner'
                      ? `一枚金币 ${brief.coinScore} 分，碰到障碍会结束，可以马上再试。`
                      : profile.runtime === 'arena-v1'
                        ? `生命 ${brief.mechanics?.maxHp ?? 5}，每 ${brief.mechanics?.xpPerLevel ?? 3} 点经验升级。`
                        : profile.genre === 'clicker'
                          ? `每次收集 ${brief.coinScore}，目标 ${brief.mechanics?.goal ?? 300}。`
                          : presetParameterText(brief) ||
                            '把操作、目标和胜负条件一起讨论清楚。'}
                  </p>
                </div>
                <div>
                  <span>03 / 怎么操作</span>
                  <strong>{profile.name}操作指南</strong>
                  <p>{profile.instructions}</p>
                </div>
                <div>
                  <span>04 / 画面方向</span>
                  <strong>可选择的原型素材</strong>
                  <p>
                    角色、背景、收集物与对手/障碍在「角色与素材」查看。新主题美术需单独准备，不会凭名称自动生成。
                  </p>
                </div>
              </div>
              {capabilities.status === 'requires_development' && (
                <div className="studio-capability-gaps" role="status">
                  <strong>自定义机制与验收</strong>
                  <ul>
                    {capabilities.development.map((item) => (
                      <li key={item.id}>{item.description}</li>
                    ))}
                  </ul>
                  <p>
                    确认后会开发新增或改变的机制，并检查所有自定义机制的实际行为，通过后才交付试玩。
                  </p>
                </div>
              )}
              {!capabilities.executable && (
                <div className="studio-capability-gaps" role="status">
                  <strong>设计已保留，制作前还需要这些能力</strong>
                  <ul>
                    {capabilities.gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                  <p>
                    可以继续完善方案，或明确同意一个已支持的首版范围；系统不会替你更改游戏类型。
                  </p>
                </div>
              )}
              {design?.markdown && (
                <section className="studio-spec" aria-label="制作说明 Spec">
                  <div>
                    <h3>制作说明 · Spec</h3>
                    <button type="button" onClick={downloadSpec}>
                      下载文档 ↓
                    </button>
                  </div>
                  <div className="studio-spec-document">
                    {design.markdown
                      .split('\n')
                      .filter(Boolean)
                      .map((line, index) => {
                        const text = line
                          .replace(/^#{1,2} /, '')
                          .replace(/^- /, '• ');
                        return line.startsWith('#') ? (
                          // biome-ignore lint/suspicious/noArrayIndexKey: Static document lines have no local state and never reorder.
                          <h4 key={index}>{text}</h4>
                        ) : (
                          // biome-ignore lint/suspicious/noArrayIndexKey: Static document lines have no local state and never reorder.
                          <p key={`line-${index}`}>{text}</p>
                        );
                      })}
                  </div>
                </section>
              )}
              <div className="studio-plan-action">
                <button
                  type="button"
                  className="studio-new"
                  disabled={Boolean(busy) || active}
                  onClick={() => setPanel('assets')}
                >
                  先让 AI 帮我准备画面素材 →
                </button>
                <p>
                  {design?.confirmedRunId
                    ? '这份说明已经确认。试玩后继续聊天，可以形成下一版方案。'
                    : design?.spec
                      ? '请检查上面的制作说明。还有想改的，继续在左侧聊；都满意了再开始制作。'
                      : '聊清楚玩法与难度后，把讨论整理成一份你能看懂的制作说明。'}
                </p>
                {design?.spec && !design.confirmedRunId ? (
                  <button
                    className="studio-primary"
                    type="button"
                    disabled={
                      Boolean(busy) ||
                      active ||
                      !readiness.createReady ||
                      !capabilities.executable
                    }
                    onClick={() => void confirm()}
                  >
                    确认说明，开始制作 →
                  </button>
                ) : (
                  <button
                    className="studio-primary"
                    type="button"
                    disabled={
                      Boolean(busy) ||
                      active ||
                      !design ||
                      design.messages.filter((m) => m.role === 'user').length <
                        1 ||
                      Boolean(design.confirmedRunId)
                    }
                    onClick={() => void prepare()}
                  >
                    方案聊好了，生成制作说明 →
                  </button>
                )}
              </div>
            </div>
          )}
          {panel === 'assets' && (
            <div className="studio-assets">
              <ArtStudio
                {...(id ? { projectId: id } : {})}
                active={active || Boolean(busy)}
                onState={setArtState}
                onSelected={async () => {
                  if (id)
                    setDesign(
                      await api<DesignDocument>(`/v1/projects/${id}/design`),
                    );
                }}
                onReview={() => setPanel('plan')}
              />
              <span className="studio-label">看得见的创作材料</span>
              <h2>原版素材参考</h2>
              <p>
                下面是默认模板的原始图片。选中的候选和当前游戏使用的素材，会在上面的素材工作室分别标注。
              </p>
              <div className="studio-asset-grid">
                {referenceArt.map((item) => (
                  <article key={item.id}>
                    <div className={`asset-art ${item.id}`}>
                      <Image
                        unoptimized
                        width={item.id === 'forest' ? 1600 : 256}
                        height={item.id === 'forest' ? 1000 : 256}
                        src={`/runner-art/${item.id}.png`}
                        alt={item.name}
                      />
                    </div>
                    <span>{item.role} · 内置</span>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                  </article>
                ))}
              </div>
              <details className="studio-uploads">
                <summary>项目素材仓库 · {assets.length} 项</summary>
                <p>
                  自动准备的候选和你上传的图片都保存在这里。你不需要上传文件也能制作；当前应用状态以上方的「当前游戏正在使用」为准。
                </p>
                {assets.map((asset) => (
                  <div key={asset.id} className="studio-upload-row">
                    <Image
                      unoptimized
                      width={48}
                      height={48}
                      src={`/v1/projects/${id}/assets/${asset.id}/content`}
                      alt={asset.name}
                    />
                    <span>{asset.name}</span>
                    <small>
                      {appliedAssets.has(asset.id)
                        ? '当前游戏正在使用'
                        : asset.importStatus === 'imported'
                          ? '已导入'
                          : asset.importStatus === 'failed'
                            ? '导入失败'
                            : '已保存 · 尚未使用'}
                    </small>
                  </div>
                ))}
                {!assets.length && (
                  <p className="studio-muted">
                    还没有上传图片，使用内置素材也能完成第一款游戏。
                  </p>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={license}
                    onChange={(event) => setLicense(event.target.checked)}
                  />{' '}
                  我拥有上传图片的使用权
                </label>
                <label
                  className={`studio-upload ${!id || !license ? 'disabled' : ''}`}
                >
                  ＋ 上传自己的图片
                  <input
                    aria-label="上传素材图片"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!id || !license || Boolean(busy)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void upload(file);
                      event.target.value = '';
                    }}
                  />
                </label>
                {!id && <small>发送第一条消息后，就可以保存素材。</small>}
              </details>
            </div>
          )}
          {panel === 'play' && (
            <div className="studio-play">
              <div className="studio-play-heading">
                <div>
                  <span className="studio-label">从想法到第一次试玩</span>
                  <h2>
                    {active
                      ? '正在制作你的游戏'
                      : preview
                        ? '来玩一局，再一起打磨。'
                        : '你的第一款游戏，即将从这里开始。'}
                  </h2>
                </div>
                {preview && (
                  <a href={preview} target="_blank" rel="noreferrer">
                    大窗口试玩 ↗
                  </a>
                )}
              </div>
              {active && (
                <div className="studio-build" role="status">
                  {run?.status !== 'paused' && (
                    <span className="studio-spinner" />
                  )}
                  <div>
                    <strong>
                      {run?.status === 'paused'
                        ? '制作已暂停'
                        : run?.status === 'pause_requested'
                          ? '正在暂停，等待当前 Unity 操作结束'
                          : run?.status === 'cancel_requested'
                            ? '正在停止，等待当前 Unity 操作结束'
                            : '正在按你确认的说明制作与检查'}
                    </strong>
                    <p>
                      {run?.status === 'paused'
                        ? '已完成的步骤会保留，继续后接着检查。'
                        : '首次制作需要几分钟。暂停或停止会等待当前 Unity 操作结束，期间保留已有试玩。'}
                    </p>
                  </div>
                  {!['pause_requested', 'cancel_requested'].includes(
                    run?.status ?? '',
                  ) && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void perform(
                          run?.status === 'paused'
                            ? '正在继续…'
                            : '正在请求暂停…',
                          async () => {
                            if (id && run)
                              setRun(
                                await api(
                                  `/v1/projects/${id}/runs/${run.id}/${run.status === 'paused' ? 'resume' : 'pause'}`,
                                  {},
                                ),
                              );
                          },
                        )
                      }
                    >
                      {run?.status === 'paused' ? '继续制作' : '暂停制作'}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={
                      Boolean(busy) || run?.status === 'cancel_requested'
                    }
                    onClick={() =>
                      void perform('正在停止制作…', async () => {
                        if (id && run)
                          setRun(
                            await api(
                              `/v1/projects/${id}/runs/${run.id}/cancel`,
                              { reason: '用户停止制作' },
                            ),
                          );
                      })
                    }
                  >
                    停止
                  </button>
                </div>
              )}
              {id && run && <AgentActivity projectId={id} run={run} />}
              {run &&
                [
                  'failed',
                  'rejected',
                  'out_of_scope',
                  'cancelled',
                  'timed_out',
                  'partially_succeeded',
                ].includes(run.status) && (
                  <div className="studio-error">
                    <p>
                      这次制作没有完成。已有的试玩版本仍可使用。你可以继续讨论并重新确认方案。
                    </p>
                    <details>
                      <summary>查看原因</summary>
                      {run.result_summary ?? run.status}
                    </details>
                  </div>
                )}
              {preview ? (
                <GamePreview status="ready" previewUrl={preview} />
              ) : (
                <div className="studio-awaiting">
                  <Image
                    unoptimized
                    width={256}
                    height={256}
                    src="/runner-art/cat.png"
                    alt="等待冒险的猫咪"
                  />
                  <h3>
                    {active
                      ? '小猫的世界正在搭建…'
                      : '先聊想法，再确认制作说明'}
                  </h3>
                  <p>
                    {active
                      ? '完成编译和检查后，游戏会出现在这里。'
                      : '你确认后，我才会开始制作。现在可以先看看素材和玩法。'}
                  </p>
                </div>
              )}
              <div className="studio-play-guide">
                <h3>第一次玩？跟着这 3 步来</h3>
                <ol>
                  <li>
                    <strong>开始冒险</strong>
                    <p>
                      {playingProfile.genre === 'runner'
                        ? '先点画面中的 START。游戏会等你准备好再计时。'
                        : '先点画面中的「开始游戏」。游戏会等你准备好再计时。'}
                    </p>
                  </li>
                  <li>
                    <strong>体验核心玩法</strong>
                    <p>{playingProfile.instructions}</p>
                  </li>
                  <li>
                    <strong>坚持到终点</strong>
                    <p>
                      {playingProfile.genre === 'clicker'
                        ? '提高收益，在倒计时结束前达到资源目标。'
                        : '注意生命和剩余时间，结束后可以重玩，再一起调整体验。'}
                    </p>
                  </li>
                </ol>
                <button
                  type="button"
                  onClick={() => {
                    rememberInput(
                      '刚才试玩了一下，我觉得太难了，请告诉我可以怎么调整',
                    );
                    setPanel('plan');
                    document.getElementById('design-message')?.focus();
                  }}
                >
                  试玩太难了？和伙伴聊聊 →
                </button>
              </div>
              {versions.length > 0 && (
                <details className="studio-history">
                  <summary>历史版本 · {versions.length} 个</summary>
                  {[...versions].reverse().map((version) => (
                    <div key={version.id}>
                      <p>
                        {version.summary}
                        <small>
                          {version.status === 'active'
                            ? '当前版本'
                            : '历史版本'}
                        </small>
                      </p>
                      <button
                        type="button"
                        disabled={
                          Boolean(busy) || active || version.status === 'active'
                        }
                        onClick={() =>
                          void perform('正在恢复版本…', async () => {
                            if (id)
                              setRun(
                                await api(
                                  `/v1/projects/${id}/versions/${version.id}/restore`,
                                  {},
                                  `restore-${crypto.randomUUID()}`,
                                ),
                              );
                          })
                        }
                      >
                        恢复这一版
                      </button>
                    </div>
                  ))}
                </details>
              )}
              {run && (
                <details
                  className="studio-history"
                  onToggle={(event) => {
                    if (event.currentTarget.open && id)
                      void api(`/v1/projects/${id}/runs/${run.id}/trace`)
                        .then((data) => setTrace(JSON.stringify(data, null, 2)))
                        .catch(() => setTrace('暂时无法读取诊断记录。'));
                  }}
                >
                  <summary>制作诊断（可选）</summary>
                  <pre>{trace || '正在读取…'}</pre>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
      <footer className="studio-footer">
        GamerHub 创作小屋 <span>先做出一个小而完整的快乐。</span>
      </footer>
    </main>
  );
}
