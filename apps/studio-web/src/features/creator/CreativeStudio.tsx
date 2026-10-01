'use client';

import {
  type CreativeDocument,
  type CreativeNode,
  type CreativeSound,
  type CreativeTrack,
  creativeEvents,
  creativeProperties,
  type DesignDocument,
  parseCreative,
  reparentCreativeNode,
  sampleTrack,
} from '@gamerhub/game-spec';
import { useEffect, useRef, useState } from 'react';
import { readApiResponse } from './api-response';
import {
  audioFileToWav,
  bytesBase64,
  CreativeAudioPreview,
} from './creative-audio';
import './creative-studio.css';

type Asset = {
  id: string;
  name: string;
  contentHash: string;
  mediaType: string;
};
type CreativeView = {
  revision: number;
  document: CreativeDocument;
  applied?: CreativeDocument;
};
const eventNames = {
  start: '开始游戏',
  score: '得分 / 进度增长',
  hit: '受到伤害',
  win: '获得胜利',
  lose: '挑战失败',
  click: '游戏中点击',
};
const kindNames = { group: '分组', sprite: '图片', rect: '色块', text: '文字' };
const propertyNames = {
  x: '位置 X',
  y: '位置 Y',
  rotation: '旋转角度',
  opacity: '不透明度',
  width: '宽度',
  height: '高度',
  frame: '精灵帧',
};
const errors = {
  DESIGN_CHANGED:
    '方案已在另一处更新。你的修改仍保留，请先导出备份，再重新载入并合并。',
  CREATIVE_INVALID: '场景数据有误，请检查层级、数值和关键帧。',
  CREATIVE_ASSET_INVALID: '素材不属于此项目或格式不支持，请重新选择。',
  PROJECT_RUN_ACTIVE: '游戏正在制作，请完成后再编辑。',
  DESIGN_DISCUSS_FIRST: '请先在左侧写下游戏想法，再把创作应用到游戏。',
  DESIGN_MODEL_UNAVAILABLE: 'AI 暂时没有响应，你的创作仍保留。',
  AUDIO_INVALID: '音频未通过检查，请换一个文件。',
  UNITY_NOT_READY: 'Unity 尚未准备好，请检查服务状态。',
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  return readApiResponse<T>(
    await fetch(path, {
      cache: 'no-store',
      signal: AbortSignal.timeout(150000),
      ...(body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
    }),
    errors,
  );
}
function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  change,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  change: (value: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={raw}
        onChange={(event) => setRaw(event.target.value)}
        onBlur={() => {
          const next = Number(raw);
          setRaw(String(value));
          if (raw.trim() && Number.isFinite(next))
            change(Math.max(min, Math.min(max, next)));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

export function CreativeStudio({
  projectId,
  active,
  onSaved,
  onApplied,
}: {
  projectId: string;
  active: boolean;
  onSaved: () => void;
  onApplied: (design: DesignDocument) => void;
}) {
  const [doc, setDoc] = useState<CreativeDocument>();
  const [revision, setRevision] = useState(0);
  const [savedJson, setSavedJson] = useState('');
  const [applied, setApplied] = useState<CreativeDocument>();
  const [selected, setSelected] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyTick, setHistoryTick] = useState(0);
  const [clipId, setClipId] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [property, setProperty] = useState<CreativeTrack['property']>('y');
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [phase, setPhase] = useState<CreativeNode['phase']>('all');
  const [prompt, setPrompt] = useState('');
  const [suggestion, setSuggestion] = useState<CreativeDocument>();
  const [license, setLicense] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const undo = useRef<CreativeDocument[]>([]),
    redo = useRef<CreativeDocument[]>([]);
  const audio = useRef<CreativeAudioPreview | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    document: CreativeDocument;
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
    inverse: DOMMatrix;
    moved: boolean;
  } | null>(null);
  const key = `gamerhub:creative:${projectId}`;
  const dirty = Boolean(doc && JSON.stringify(doc) !== savedJson);
  const locked = active || Boolean(busy);
  const node = doc?.nodes.find((n) => n.id === selected);
  const clip = doc?.clips.find((c) => c.id === clipId);
  const selectedTrack = clip?.tracks.find(
    (t) => t.nodeId === selected && t.property === property,
  );
  void historyTick;

  async function load(recover = false) {
    setBusy('正在读取创作…');
    setError('');
    try {
      const [view, library] = await Promise.all([
        api<CreativeView>(`/v1/projects/${projectId}/creative`),
        api<{ items: Asset[] }>(`/v1/projects/${projectId}/assets`),
      ]);
      const checked = parseCreative(view.document);
      setApplied(view.applied ? parseCreative(view.applied) : undefined);
      setRevision(view.revision);
      setSavedJson(JSON.stringify(checked));
      setAssets(library.items);
      let document = checked;
      if (recover) {
        try {
          const local = JSON.parse(localStorage.getItem(key) ?? 'null');
          if (local?.document && local.base === view.revision) {
            document = parseCreative(local.document);
            setNotice('已恢复此浏览器未保存的创作。');
          } else if (local?.document)
            setNotice('检测到旧草稿；可导出本地备份，再决定如何合并。');
        } catch {
          setNotice('本地草稿无法读取，已载入服务器保存的版本。');
        }
      } else {
        localStorage.removeItem(key);
        setNotice('已重新载入服务器版本。');
      }
      setDoc(document);
      undo.current = [];
      redo.current = [];
      setHistoryTick((t) => t + 1);
      setSelected('');
      setPlaying(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败。');
    } finally {
      setBusy('');
    }
  }
  // Project-scoped mount: the parent keys this component by project ID.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reloading on every render would replace the user's draft.
  useEffect(() => {
    void load(true);
    audio.current = new CreativeAudioPreview();
    return () => audio.current?.close();
  }, [projectId]);
  useEffect(() => {
    if (!doc) return;
    try {
      if (!dirty) {
        const local = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (local?.base === revision) localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(
        key,
        JSON.stringify({ base: revision, document: doc }),
      );
    } catch {
      setNotice('浏览器无法保存本地草稿，请及时保存或导出。');
    }
  }, [doc, dirty, key, revision]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (!playing || !clip) return;
    let frame = 0,
      previous = performance.now();
    function tick(now: number) {
      const delta = (now - previous) / 1000;
      previous = now;
      setTime((value) => {
        const next = value + delta;
        if (next > (clip?.duration ?? 2)) {
          if (!clip?.loop) {
            setPlaying(false);
            return clip?.duration ?? 2;
          }
          return next % clip.duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, clip]);
  useEffect(() => {
    if (active) {
      setPlaying(false);
      audio.current?.stop();
    }
  }, [active]);

  function commit(change: (draft: CreativeDocument) => void) {
    if (!doc || locked) return;
    const next = structuredClone(doc);
    change(next);
    try {
      const checked = parseCreative(next);
      if (JSON.stringify(checked) === JSON.stringify(doc)) return;
      undo.current = [...undo.current.slice(-99), doc];
      redo.current = [];
      setDoc(checked);
      setSuggestion(undefined);
      setHistoryTick((t) => t + 1);
      setError('');
      setNotice('有未保存的创作。');
    } catch {
      setError('这项修改无效：请检查是否产生循环层级、越界数值或无效关键帧。');
    }
  }
  function changeNode(patch: Partial<CreativeNode>) {
    commit((draft) => {
      const n = draft.nodes.find((n) => n.id === selected);
      if (n) Object.assign(n, patch);
    });
  }
  function history(direction: 'undo' | 'redo') {
    if (!doc || locked) return;
    const from = direction === 'undo' ? undo : redo,
      to = direction === 'undo' ? redo : undo;
    const previous = from.current.pop();
    if (!previous) return;
    to.current.push(doc);
    setDoc(previous);
    setHistoryTick((t) => t + 1);
    setPlaying(false);
  }
  function addNode(kind: CreativeNode['kind'], asset?: Asset) {
    const id = uid(kind);
    commit((draft) => {
      draft.nodes.push({
        id,
        name:
          kind === 'text' ? '新文字' : (asset?.name ?? `新${kindNames[kind]}`),
        kind,
        parentId: '',
        x: 480,
        y: 80,
        width: kind === 'text' ? 280 : 100,
        height: kind === 'text' ? 48 : 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        phase: 'all',
        color: kind === 'sprite' ? '#ffffff' : '#f2c97c',
        text: kind === 'text' ? '我的游戏世界' : '',
        assetId: asset?.id ?? '',
        contentHash: asset?.contentHash ?? '',
        columns: 1,
        rows: 1,
      });
    });
    setSelected(id);
  }
  function removeNode() {
    if (!node) return;
    commit((draft) => {
      const ids = new Set([node.id]);
      for (let i = 0; i < draft.nodes.length; i++)
        for (const n of draft.nodes) if (ids.has(n.parentId)) ids.add(n.id);
      draft.nodes = draft.nodes.filter((n) => !ids.has(n.id));
      draft.clips = draft.clips
        .map((c) => ({
          ...c,
          tracks: c.tracks.filter((t) => !ids.has(t.nodeId)),
        }))
        .filter((c) => c.tracks.length);
    });
    setSelected('');
  }
  function duplicate() {
    if (!node || !doc) return;
    const rootId = uid(node.kind);
    commit((draft) => {
      const ids = new Map([[node.id, rootId]]);
      for (let i = 0; i < doc.nodes.length; i++)
        for (const n of doc.nodes)
          if (ids.has(n.parentId) && !ids.has(n.id)) ids.set(n.id, uid(n.kind));
      for (const n of doc.nodes)
        if (ids.has(n.id))
          draft.nodes.push({
            ...n,
            id: ids.get(n.id) as string,
            parentId:
              n.id === node.id ? n.parentId : (ids.get(n.parentId) ?? ''),
            name: `${n.name} 副本`,
            x: n.x + (n.id === node.id ? 20 : 0),
            y: n.y + (n.id === node.id ? 20 : 0),
          });
    });
    setSelected(rootId);
  }
  function addAnimation() {
    if (!node) return;
    const id = uid('clip');
    commit((draft) =>
      draft.clips.push({
        id,
        name: `${node.name} · 漂浮`,
        duration: 2,
        loop: true,
        trigger: 'start',
        tracks: [
          {
            nodeId: node.id,
            property: 'y',
            keys: [
              { time: 0, value: node.y },
              { time: 1, value: Math.max(-1200, node.y - 20) },
              { time: 2, value: node.y },
            ],
          },
        ],
      }),
    );
    setClipId(id);
    setProperty('y');
    setTime(0);
  }
  function addSound(asset?: Asset) {
    commit((draft) =>
      draft.sounds.push({
        id: uid('sound'),
        name: asset?.name ?? '清脆提示音',
        source: asset ? 'asset' : 'tone',
        assetId: asset?.id ?? '',
        contentHash: asset?.contentHash ?? '',
        trigger: 'score',
        volume: 0.5,
        loop: false,
        frequency: 660,
        duration: 0.18,
      }),
    );
  }
  function changeSound(id: string, patch: Partial<CreativeSound>) {
    commit((draft) => {
      const sound = draft.sounds.find((s) => s.id === id);
      if (sound) Object.assign(sound, patch);
    });
  }
  async function perform(label: string, action: () => Promise<void>) {
    if (locked) return;
    setBusy(label);
    setError('');
    setPlaying(false);
    audio.current?.stop();
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，创作仍保留。');
    } finally {
      setBusy('');
    }
  }
  async function save(apply = false) {
    if (!doc) return;
    await perform(apply ? '正在保存并安排制作…' : '正在保存创作…', async () => {
      const result = await api<CreativeView>(
        `/v1/projects/${projectId}/creative`,
        { revision, document: doc },
      );
      setRevision(result.revision);
      setDoc(result.document);
      setSavedJson(JSON.stringify(result.document));
      localStorage.removeItem(key);
      onSaved();
      setNotice('创作已保存，制作后会出现在试玩中。');
      if (apply)
        onApplied(
          await api<DesignDocument>(
            `/v1/projects/${projectId}/creative/apply`,
            { revision: result.revision },
          ),
        );
    });
  }
  function download(value: unknown, filename: string) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function uploadAudio(file: File) {
    await perform('正在转换并检查音频…', async () => {
      const bytes = await audioFileToWav(file);
      const asset = await api<Asset>(`/v1/projects/${projectId}/assets`, {
        name: `${file.name.replace(/\.[^.]+$/, '').slice(0, 180)}.wav`,
        mime_type: 'audio/wav',
        bytes_base64: bytesBase64(bytes),
        license_text: '我确认有权在此游戏中使用并发布此音频。',
      });
      setAssets((current) => [...current, asset]);
      setNotice('音频已导入；点击素材名称，把它绑定到游戏事件。');
    });
  }
  const poses = new Map(
    doc?.nodes.map((n) => [n.id, { ...n, frame: 0 }]) ?? [],
  );
  if (clip)
    for (const track of clip.tracks) {
      const pose = poses.get(track.nodeId);
      if (pose) pose[track.property] = sampleTrack(track, time);
    }
  function renderNode(n: CreativeNode) {
    const p = poses.get(n.id);
    if (!p) return null;
    const visible =
      n.visible && (phase === 'all' || n.phase === 'all' || n.phase === phase);
    const frame = Math.floor(p.frame),
      source = `/v1/projects/${projectId}/assets/${n.assetId}/content`;
    return (
      <g
        key={n.id}
        data-node={n.id}
        transform={`translate(${p.x} ${p.y}) rotate(${p.rotation})`}
        opacity={visible ? p.opacity : 0.15}
      >
        {n.kind === 'rect' && (
          <rect
            x={-p.width / 2}
            y={-p.height / 2}
            width={p.width}
            height={p.height}
            fill={n.color}
          />
        )}
        {n.kind === 'text' && (
          <foreignObject
            x={-p.width / 2}
            y={-p.height / 2}
            width={p.width}
            height={p.height}
          >
            <div
              className="creative-stage-text"
              style={{
                color: n.color,
                fontSize: Math.min(80, Math.max(10, p.height * 0.6)),
              }}
            >
              {n.text}
            </div>
          </foreignObject>
        )}
        {n.kind === 'sprite' && (
          <svg
            x={-p.width / 2}
            y={-p.height / 2}
            width={p.width}
            height={p.height}
            viewBox={`${(frame % n.columns) * p.width} ${Math.floor(frame / n.columns) * p.height} ${p.width} ${p.height}`}
            preserveAspectRatio="none"
            overflow="hidden"
          >
            <title>{n.name}</title>
            <defs>
              <filter
                id={`creative-tint-${n.id}`}
                colorInterpolationFilters="sRGB"
              >
                <feColorMatrix
                  type="matrix"
                  values={`${Number.parseInt(n.color.slice(1, 3), 16) / 255} 0 0 0 0 0 ${Number.parseInt(n.color.slice(3, 5), 16) / 255} 0 0 0 0 0 ${Number.parseInt(n.color.slice(5, 7), 16) / 255} 0 0 0 0 0 1 0`}
                />
              </filter>
            </defs>
            <image
              href={source}
              filter={`url(#creative-tint-${n.id})`}
              width={p.width * n.columns}
              height={p.height * n.rows}
              preserveAspectRatio="none"
            />
          </svg>
        )}
        <rect
          x={-p.width / 2}
          y={-p.height / 2}
          width={p.width}
          height={p.height}
          fill="transparent"
          stroke={
            selected === n.id
              ? '#62ecc4'
              : n.kind === 'group'
                ? '#647b8a'
                : 'none'
          }
          strokeWidth={2}
          strokeDasharray={n.kind === 'group' ? '6 4' : undefined}
        />
        {doc?.nodes.filter((child) => child.parentId === n.id).map(renderNode)}
      </g>
    );
  }
  function hierarchy(parentId = '', depth = 0): React.ReactNode {
    return doc?.nodes
      .filter((n) => n.parentId === parentId)
      .map((n) => (
        <div key={n.id}>
          <button
            type="button"
            className={selected === n.id ? 'is-selected' : ''}
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => setSelected(n.id)}
            aria-pressed={selected === n.id}
            aria-label={n.name}
          >
            {n.name}
            <small>
              {kindNames[n.kind]}
              {n.visible ? '' : ' · 隐藏'}
            </small>
          </button>
          {hierarchy(n.id, depth + 1)}
        </div>
      ));
  }

  return (
    <section className="creative-studio" aria-label="场景动画声音编辑器">
      <div className="creative-intro">
        <div>
          <span>SCENE · MOTION · SOUND</span>
          <h2>让游戏有自己的表情。</h2>
          <p>
            编辑 2D
            创作层的文字、图片、动画与声音。玩法对象和碰撞继续由游戏方案管理。
          </p>
        </div>
        <span className="creative-status">
          {active
            ? '制作中 · 已锁定'
            : dirty
              ? '有未保存修改'
              : applied && JSON.stringify(doc) !== JSON.stringify(applied)
                ? '已保存 · 待制作'
                : '已同步'}
        </span>
      </div>
      {error && (
        <p className="creative-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="creative-notice" role="status">
          {notice}
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      {!doc ? (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void load(true)}
        >
          重新读取创作
        </button>
      ) : (
        <>
          <div className="creative-toolbar">
            <button
              type="button"
              disabled={locked}
              onClick={() => addNode('text')}
            >
              添加文字
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => addNode('rect')}
            >
              添加色块
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => addNode('group')}
            >
              添加分组
            </button>
            <button
              type="button"
              disabled={locked || !undo.current.length}
              onClick={() => history('undo')}
            >
              撤销
            </button>
            <button
              type="button"
              disabled={locked || !redo.current.length}
              onClick={() => history('redo')}
            >
              重做
            </button>
            <button
              type="button"
              className="creative-primary"
              disabled={locked}
              onClick={() => void save()}
            >
              保存创作
            </button>
            <button
              type="button"
              disabled={
                locked ||
                (!!applied && JSON.stringify(doc) === JSON.stringify(applied))
              }
              onClick={() => void save(true)}
            >
              保存并制作试玩
            </button>
          </div>
          <div className="creative-canvas-tools">
            <label>
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              10px 吸附
            </label>
            <label>
              缩放
              <select
                aria-label="画布缩放"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                <option value={0.75}>75%</option>
                <option value={1}>适应宽度</option>
                <option value={1.5}>150%</option>
                <option value={2}>200%</option>
              </select>
            </label>
            <label>
              显示阶段
              <select
                aria-label="预览游戏阶段"
                value={phase}
                onChange={(e) =>
                  setPhase(e.target.value as CreativeNode['phase'])
                }
              >
                <option value="all">全部创作</option>
                <option value="ready">准备开始</option>
                <option value="playing">游戏中</option>
                <option value="paused">已暂停</option>
                <option value="won">胜利</option>
                <option value="lost">失败</option>
              </select>
            </label>
            <span>960 × 600 · 拖动对象，方向键微调</span>
          </div>
          <div className="creative-stage-scroll">
            <svg
              ref={svg}
              className="creative-stage"
              style={{ width: `${zoom * 100}%` }}
              viewBox="0 0 960 600"
              role="application"
              aria-label="场景画布"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: This application canvas supports keyboard movement and undo.
              tabIndex={0}
              onPointerDown={(event) => {
                if (locked || !doc) return;
                const element = (event.target as Element).closest(
                  '[data-node]',
                ) as SVGGElement | null;
                if (!element) {
                  setSelected('');
                  return;
                }
                const id = element.dataset.node ?? '',
                  target = doc.nodes.find((n) => n.id === id),
                  parent =
                    element.parentElement as unknown as SVGGraphicsElement;
                const matrix = parent.getScreenCTM();
                if (!target || !matrix) return;
                const inverse = matrix.inverse(),
                  point = new DOMPoint(
                    event.clientX,
                    event.clientY,
                  ).matrixTransform(inverse);
                setSelected(id);
                setPlaying(false);
                setTime(0);
                svg.current?.focus();
                svg.current?.setPointerCapture(event.pointerId);
                drag.current = {
                  document: doc,
                  id,
                  x: target.x,
                  y: target.y,
                  startX: point.x,
                  startY: point.y,
                  inverse,
                  moved: false,
                };
                event.preventDefault();
              }}
              onPointerMove={(event) => {
                const current = drag.current;
                if (!current || locked) return;
                const point = new DOMPoint(
                    event.clientX,
                    event.clientY,
                  ).matrixTransform(current.inverse),
                  unit = snap ? 10 : 1;
                const x = Math.max(
                    -1920,
                    Math.min(
                      2880,
                      Math.round(
                        (current.x + point.x - current.startX) / unit,
                      ) * unit,
                    ),
                  ),
                  y = Math.max(
                    -1200,
                    Math.min(
                      1800,
                      Math.round(
                        (current.y + point.y - current.startY) / unit,
                      ) * unit,
                    ),
                  );
                if (x === current.x && y === current.y) return;
                current.moved = true;
                setDoc({
                  ...current.document,
                  nodes: current.document.nodes.map((n) =>
                    n.id === current.id ? { ...n, x, y } : n,
                  ),
                });
              }}
              onPointerUp={() => {
                const current = drag.current;
                if (current?.moved) {
                  undo.current = [...undo.current.slice(-99), current.document];
                  redo.current = [];
                  setHistoryTick((t) => t + 1);
                }
                drag.current = null;
              }}
              onPointerCancel={() => {
                if (drag.current) setDoc(drag.current.document);
                drag.current = null;
              }}
              onKeyDown={(event) => {
                if (locked) return;
                if (
                  (event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === 'z'
                ) {
                  event.preventDefault();
                  history(event.shiftKey ? 'redo' : 'undo');
                } else if (
                  event.key === 'Delete' ||
                  event.key === 'Backspace'
                ) {
                  event.preventDefault();
                  removeNode();
                } else if (
                  node &&
                  ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                    event.key,
                  )
                ) {
                  event.preventDefault();
                  const delta = event.shiftKey ? 10 : 1;
                  changeNode({
                    x:
                      node.x +
                      (event.key === 'ArrowRight'
                        ? delta
                        : event.key === 'ArrowLeft'
                          ? -delta
                          : 0),
                    y:
                      node.y +
                      (event.key === 'ArrowDown'
                        ? delta
                        : event.key === 'ArrowUp'
                          ? -delta
                          : 0),
                  });
                }
              }}
            >
              <title>960 × 600 创作画布</title>
              <defs>
                <pattern
                  id={`grid-${projectId}`}
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M40 0H0V40"
                    fill="none"
                    stroke="#28414c"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect width="960" height="600" fill="#122b36" />
              <rect width="960" height="600" fill={`url(#grid-${projectId})`} />
              <rect
                x="24"
                y="24"
                width="912"
                height="552"
                fill="none"
                stroke="#53727b"
                strokeDasharray="8 8"
                pointerEvents="none"
              />
              {doc.nodes.filter((n) => !n.parentId).map(renderNode)}
              {!doc.nodes.length && (
                <text
                  x="480"
                  y="300"
                  textAnchor="middle"
                  fill="#9db4bc"
                  fontSize="22"
                >
                  添加文字或图片，开始布置你的游戏
                </text>
              )}
            </svg>
          </div>
          <div className="creative-details">
            <aside className="creative-hierarchy">
              <h3>
                场景层级 <small>{doc.nodes.length}/100</small>
              </h3>
              {hierarchy()}
              {!doc.nodes.length && (
                <p>每个对象都能单独命名、移动和制作动画。</p>
              )}
              <div className="creative-row">
                <button
                  type="button"
                  disabled={locked || !node}
                  onClick={duplicate}
                >
                  复制对象
                </button>
                <button
                  type="button"
                  disabled={locked || !node}
                  onClick={removeNode}
                >
                  删除对象
                </button>
              </div>
              <p>删除分组也会删除其中的对象和关联轨道；可撤销。</p>
            </aside>
            <fieldset
              className="creative-properties"
              disabled={locked || !node}
            >
              <legend>对象属性</legend>
              {node ? (
                <>
                  <label>
                    对象名称
                    <input
                      aria-label="对象名称"
                      value={node.name}
                      maxLength={80}
                      onChange={(e) =>
                        changeNode({ name: e.target.value || '未命名' })
                      }
                    />
                  </label>
                  <label>
                    所属分组
                    <select
                      aria-label="所属分组"
                      value={node.parentId}
                      onChange={(e) =>
                        commit((draft) =>
                          Object.assign(
                            draft,
                            reparentCreativeNode(
                              draft,
                              node.id,
                              e.target.value,
                            ),
                          ),
                        )
                      }
                    >
                      <option value="">场景根级</option>
                      {doc.nodes
                        .filter((n) => n.kind === 'group' && n.id !== node.id)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="creative-number-grid">
                    <NumberField
                      label="位置 X"
                      value={node.x}
                      min={-1920}
                      max={2880}
                      change={(x) => changeNode({ x })}
                    />
                    <NumberField
                      label="位置 Y"
                      value={node.y}
                      min={-1200}
                      max={1800}
                      change={(y) => changeNode({ y })}
                    />
                    <NumberField
                      label="宽度"
                      value={node.width}
                      min={1}
                      max={1920}
                      change={(width) => changeNode({ width })}
                    />
                    <NumberField
                      label="高度"
                      value={node.height}
                      min={1}
                      max={1200}
                      change={(height) => changeNode({ height })}
                    />
                    <NumberField
                      label="旋转角度"
                      value={node.rotation}
                      min={-360}
                      max={360}
                      change={(rotation) => changeNode({ rotation })}
                    />
                    <NumberField
                      label="不透明度"
                      value={node.opacity}
                      min={0}
                      max={1}
                      step={0.05}
                      change={(opacity) => changeNode({ opacity })}
                    />
                  </div>
                  <label>
                    颜色 / 图片染色
                    <input
                      type="color"
                      aria-label="对象颜色"
                      value={node.color}
                      onChange={(e) => changeNode({ color: e.target.value })}
                    />
                  </label>
                  {node.kind === 'text' && (
                    <label>
                      文字内容
                      <textarea
                        aria-label="文字内容"
                        maxLength={500}
                        value={node.text}
                        onChange={(e) => changeNode({ text: e.target.value })}
                      />
                    </label>
                  )}
                  {node.kind === 'sprite' && (
                    <>
                      <label>
                        图片素材
                        <select
                          aria-label="图片素材"
                          value={node.assetId}
                          onChange={(e) => {
                            const asset = assets.find(
                              (a) => a.id === e.target.value,
                            );
                            if (asset)
                              changeNode({
                                assetId: asset.id,
                                contentHash: asset.contentHash,
                              });
                          }}
                        >
                          {assets
                            .filter((a) =>
                              ['image/png', 'image/jpeg'].includes(a.mediaType),
                            )
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="creative-number-grid">
                        <NumberField
                          label="精灵表列数"
                          value={node.columns}
                          min={1}
                          max={16}
                          change={(columns) =>
                            changeNode({ columns: Math.round(columns) })
                          }
                        />
                        <NumberField
                          label="精灵表行数"
                          value={node.rows}
                          min={1}
                          max={16}
                          change={(rows) =>
                            changeNode({ rows: Math.round(rows) })
                          }
                        />
                      </div>
                    </>
                  )}
                  <label>
                    出现阶段
                    <select
                      aria-label="对象出现阶段"
                      value={node.phase}
                      onChange={(e) =>
                        changeNode({
                          phase: e.target.value as CreativeNode['phase'],
                        })
                      }
                    >
                      {['all', 'ready', 'playing', 'paused', 'won', 'lost'].map(
                        (value, i) => (
                          <option key={value} value={value}>
                            {
                              [
                                '所有阶段',
                                '准备开始',
                                '游戏进行中',
                                '暂停',
                                '胜利',
                                '失败',
                              ][i]
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={node.visible}
                      onChange={(e) =>
                        changeNode({ visible: e.target.checked })
                      }
                    />
                    显示对象
                  </label>
                  <div className="creative-row">
                    <button
                      type="button"
                      onClick={() =>
                        commit((d) => {
                          const index = d.nodes.findIndex(
                            (n) => n.id === node.id,
                          );
                          const item = d.nodes.splice(index, 1)[0];
                          if (item) d.nodes.unshift(item);
                        })
                      }
                    >
                      移到底层
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        commit((d) => {
                          const index = d.nodes.findIndex(
                            (n) => n.id === node.id,
                          );
                          const item = d.nodes.splice(index, 1)[0];
                          if (item) d.nodes.push(item);
                        })
                      }
                    >
                      移到顶层
                    </button>
                  </div>
                </>
              ) : (
                <p>选择一个对象，调整位置、尺寸和外观。</p>
              )}
            </fieldset>
          </div>
          <details className="creative-library">
            <summary>图片素材库 · 点击加入场景</summary>
            <p>
              先在「角色与素材」上传或生成图片。此处支持 PNG /
              JPEG；精灵表使用等宽等高的网格。
            </p>
            <div className="creative-row">
              {assets
                .filter((a) =>
                  ['image/png', 'image/jpeg'].includes(a.mediaType),
                )
                .map((a) => (
                  <button
                    type="button"
                    disabled={locked}
                    key={a.id}
                    onClick={() => addNode('sprite', a)}
                  >
                    {a.name}
                  </button>
                ))}
            </div>
          </details>
          <section className="creative-timeline" aria-label="动画时间轴">
            <div className="creative-heading">
              <h3>动画时间轴</h3>
              <button
                type="button"
                disabled={locked || !node}
                onClick={addAnimation}
              >
                添加漂浮动画
              </button>
            </div>
            <p>
              选择对象和属性，在时间点添加关键帧。位置等数值线性过渡，精灵帧逐帧切换；分组动画会带动所有子对象。
            </p>
            <label>
              动画片段
              <select
                aria-label="动画片段"
                value={clipId}
                onChange={(e) => {
                  setClipId(e.target.value);
                  setTime(0);
                  setPlaying(false);
                }}
              >
                <option value="">选择动画</option>
                {doc.clips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {clip && (
              <>
                <div className="creative-row">
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      if (time >= clip.duration) setTime(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? '暂停动画预览' : '播放动画预览'}
                  </button>
                  <output>
                    {time.toFixed(2)} / {clip.duration.toFixed(2)} 秒
                  </output>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      commit((d) => {
                        d.clips = d.clips.filter((c) => c.id !== clip.id);
                      });
                      setClipId('');
                      setPlaying(false);
                    }}
                  >
                    删除动画
                  </button>
                </div>
                <input
                  aria-label="动画播放位置"
                  type="range"
                  min={0}
                  max={clip.duration}
                  step={0.01}
                  value={time}
                  onChange={(e) => {
                    setPlaying(false);
                    setTime(Number(e.target.value));
                  }}
                />
                <div className="creative-number-grid">
                  <NumberField
                    label="动画时长"
                    value={clip.duration}
                    min={0.1}
                    max={60}
                    step={0.1}
                    change={(duration) =>
                      commit((d) => {
                        const c = d.clips.find((c) => c.id === clip.id);
                        if (c) {
                          const scale = duration / c.duration;
                          for (const t of c.tracks)
                            for (const k of t.keys) k.time *= scale;
                          c.duration = duration;
                          setTime(0);
                        }
                      })
                    }
                  />
                  <label>
                    触发事件
                    <select
                      aria-label="动画触发事件"
                      disabled={locked}
                      value={clip.trigger}
                      onChange={(e) =>
                        commit((d) => {
                          const c = d.clips.find((c) => c.id === clip.id);
                          if (c) c.trigger = e.target.value as typeof c.trigger;
                        })
                      }
                    >
                      {creativeEvents.map((event) => (
                        <option key={event} value={event}>
                          {eventNames[event]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={clip.loop}
                    onChange={(e) =>
                      commit((d) => {
                        const c = d.clips.find((c) => c.id === clip.id);
                        if (c) c.loop = e.target.checked;
                      })
                    }
                  />
                  循环播放
                </label>
                <div className="creative-row">
                  <label>
                    动画属性
                    <select
                      aria-label="动画属性"
                      value={property}
                      onChange={(e) =>
                        setProperty(e.target.value as CreativeTrack['property'])
                      }
                    >
                      {creativeProperties.map((p) => (
                        <option key={p} value={p}>
                          {propertyNames[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={locked || !node}
                    onClick={() =>
                      commit((d) => {
                        const c = d.clips.find((c) => c.id === clip.id);
                        if (!c || !node) return;
                        let track = c.tracks.find(
                          (t) =>
                            t.nodeId === node.id && t.property === property,
                        );
                        if (!track) {
                          track = { nodeId: node.id, property, keys: [] };
                          c.tracks.push(track);
                        }
                        const at = Math.round(time * 100) / 100;
                        track.keys = track.keys.filter(
                          (k) => Math.abs(k.time - at) > 0.001,
                        );
                        track.keys.push({
                          time: at,
                          value: property === 'frame' ? 0 : node[property],
                        });
                        track.keys.sort((a, b) => a.time - b.time);
                      })
                    }
                  >
                    在此时刻添加关键帧
                  </button>
                </div>
                <div className="creative-tracks">
                  {clip.tracks.map((track) => (
                    <button
                      key={`${track.nodeId}:${track.property}`}
                      type="button"
                      aria-pressed={
                        track.nodeId === selected && track.property === property
                      }
                      onClick={() => {
                        setSelected(track.nodeId);
                        setProperty(track.property);
                      }}
                    >
                      {doc.nodes.find((n) => n.id === track.nodeId)?.name} ·{' '}
                      {propertyNames[track.property]} · {track.keys.length} 帧
                    </button>
                  ))}
                </div>
                {selectedTrack && (
                  <div className="creative-keys">
                    {selectedTrack.keys.map((k) => (
                      <div key={k.time}>
                        <button
                          type="button"
                          onClick={() => {
                            setTime(k.time);
                            setPlaying(false);
                          }}
                        >
                          {k.time.toFixed(2)}s ◆
                        </button>
                        <NumberField
                          label={`关键帧 ${k.time.toFixed(2)} 秒的值`}
                          value={k.value}
                          min={
                            property === 'opacity' || property === 'frame'
                              ? 0
                              : property === 'width' || property === 'height'
                                ? 1
                                : property === 'x'
                                  ? -1920
                                  : property === 'y'
                                    ? -1200
                                    : -360
                          }
                          max={
                            property === 'opacity'
                              ? 1
                              : property === 'frame'
                                ? (node?.columns ?? 1) * (node?.rows ?? 1) - 1
                                : property === 'x'
                                  ? 2880
                                  : property === 'y'
                                    ? 1800
                                    : property === 'width'
                                      ? 1920
                                      : property === 'height'
                                        ? 1200
                                        : 360
                          }
                          step={property === 'opacity' ? 0.05 : 1}
                          change={(value) =>
                            commit((d) => {
                              const target = d.clips
                                .find((c) => c.id === clip.id)
                                ?.tracks.find(
                                  (t) =>
                                    t.nodeId === selected &&
                                    t.property === property,
                                )
                                ?.keys.find((item) => item.time === k.time);
                              if (target) target.value = value;
                            })
                          }
                        />
                        <button
                          type="button"
                          disabled={locked || selectedTrack.keys.length === 1}
                          aria-label={`删除 ${k.time.toFixed(2)} 秒关键帧`}
                          onClick={() =>
                            commit((d) => {
                              const track = d.clips
                                .find((c) => c.id === clip.id)
                                ?.tracks.find(
                                  (t) =>
                                    t.nodeId === selected &&
                                    t.property === property,
                                );
                              if (track)
                                track.keys = track.keys.filter(
                                  (item) => item.time !== k.time,
                                );
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
          <section className="creative-sounds" aria-label="游戏声音">
            <div className="creative-heading">
              <h3>游戏声音</h3>
              <button
                type="button"
                disabled={locked}
                onClick={() => addSound()}
              >
                添加提示音
              </button>
            </div>
            <p>
              音频跟随暂停和重开。循环音乐仅绑定开始事件；游戏右下角可静音，也可按
              M。
            </p>
            <NumberField
              label="游戏总音量"
              value={doc.masterVolume}
              min={0}
              max={1}
              step={0.05}
              change={(masterVolume) =>
                commit((d) => {
                  d.masterVolume = masterVolume;
                })
              }
            />
            {doc.sounds.map((sound) => (
              <fieldset
                key={sound.id}
                disabled={locked}
                className="creative-sound"
              >
                <legend>{sound.name}</legend>
                <div className="creative-number-grid">
                  <label>
                    声音名称
                    <input
                      aria-label={`声音名称 ${sound.id}`}
                      value={sound.name}
                      maxLength={80}
                      onChange={(e) =>
                        changeSound(sound.id, {
                          name: e.target.value || '声音',
                        })
                      }
                    />
                  </label>
                  <label>
                    声音触发
                    <select
                      aria-label={`声音触发 ${sound.name}`}
                      value={sound.trigger}
                      onChange={(e) =>
                        changeSound(sound.id, {
                          trigger: e.target.value as CreativeSound['trigger'],
                          ...(e.target.value === 'start'
                            ? {}
                            : { loop: false }),
                        })
                      }
                    >
                      {creativeEvents.map((event) => (
                        <option key={event} value={event}>
                          {eventNames[event]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    label={`${sound.name} 音量`}
                    value={sound.volume}
                    min={0}
                    max={1}
                    step={0.05}
                    change={(volume) => changeSound(sound.id, { volume })}
                  />
                  {sound.source === 'tone' && (
                    <>
                      <NumberField
                        label={`${sound.name} 音高 Hz`}
                        value={sound.frequency}
                        min={80}
                        max={2000}
                        change={(frequency) =>
                          changeSound(sound.id, { frequency })
                        }
                      />
                      <NumberField
                        label={`${sound.name} 时长`}
                        value={sound.duration}
                        min={0.03}
                        max={3}
                        step={0.01}
                        change={(duration) =>
                          changeSound(sound.id, { duration })
                        }
                      />
                    </>
                  )}
                </div>
                <div className="creative-row">
                  <label>
                    <input
                      type="checkbox"
                      disabled={sound.trigger !== 'start'}
                      checked={sound.loop}
                      onChange={(e) =>
                        changeSound(sound.id, { loop: e.target.checked })
                      }
                    />
                    循环
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      void audio.current
                        ?.play(sound, doc.masterVolume, projectId)
                        .catch((e) => setError(e.message));
                    }}
                  >
                    试听 {sound.name}
                  </button>
                  <button type="button" onClick={() => audio.current?.stop()}>
                    停止试听
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      commit((d) => {
                        d.sounds = d.sounds.filter((s) => s.id !== sound.id);
                      })
                    }
                  >
                    删除声音
                  </button>
                </div>
              </fieldset>
            ))}
            <div className="creative-import">
              <label>
                <input
                  type="checkbox"
                  checked={license}
                  onChange={(e) => setLicense(e.target.checked)}
                />
                我有权使用并发布所选音频
              </label>
              <label className="creative-file">
                导入音乐或音效
                <input
                  aria-label="导入音乐或音效"
                  disabled={locked || !license}
                  type="file"
                  accept="audio/*,.wav,.mp3,.ogg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadAudio(file);
                    e.target.value = '';
                  }}
                />
              </label>
              <p>
                支持此浏览器能解码的 WAV、MP3、OGG 等格式，转换后保存为 PCM
                WAV。最长 60 秒；试听最多 10 秒。
              </p>
              <div className="creative-row">
                {assets
                  .filter((a) => a.mediaType === 'audio/wav')
                  .map((a) => (
                    <button
                      type="button"
                      disabled={locked}
                      key={a.id}
                      onClick={() => addSound(a)}
                    >
                      {a.name}
                    </button>
                  ))}
              </div>
            </div>
          </section>
          <section className="creative-assistant">
            <h3>让 AI 帮你编排</h3>
            <p>
              例如：在左上角加一个星光招牌，开始后轻轻漂浮，得分时响一声。AI
              建议先预览，再由你决定是否采用。
            </p>
            <textarea
              aria-label="描述场景动画声音"
              placeholder="描述想要的场景、动画或声音…"
              maxLength={2000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button
              type="button"
              disabled={locked || !prompt.trim() || dirty}
              onClick={() =>
                void perform('AI 正在编排创作…', async () => {
                  const result = await api<CreativeView>(
                    `/v1/projects/${projectId}/creative/suggest`,
                    { revision, prompt },
                  );
                  setSuggestion(parseCreative(result.document));
                })
              }
            >
              生成编排建议
            </button>
            {dirty && <p>先保存当前创作，AI 才能在最新内容上继续。</p>}
            {suggestion && (
              <div className="creative-suggestion">
                <strong>
                  建议：{suggestion.nodes.length} 个对象 ·{' '}
                  {suggestion.clips.length} 个动画 · {suggestion.sounds.length}{' '}
                  个声音
                </strong>
                <p>
                  {suggestion.nodes.map((n) => n.name).join('、') ||
                    '没有场景对象'}
                </p>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    commit((d) => Object.assign(d, suggestion));
                    setSuggestion(undefined);
                    setNotice(
                      'AI 建议已放入画布，可继续修改或撤销；尚未保存和制作。',
                    );
                  }}
                >
                  采用到画布
                </button>
                <button
                  type="button"
                  onClick={() => download(suggestion, 'AI创作建议.json')}
                >
                  导出建议查看
                </button>
                <button type="button" onClick={() => setSuggestion(undefined)}>
                  不采用
                </button>
              </div>
            )}
          </section>
          <details className="creative-backup">
            <summary>备份与恢复</summary>
            <div className="creative-row">
              <button
                type="button"
                disabled={locked || !applied}
                onClick={() => {
                  if (applied) {
                    commit((draft) => Object.assign(draft, applied));
                    setNotice(
                      '已把当前试玩版本的创作放入画布，可撤销；保存后才会替换草稿。',
                    );
                  }
                }}
              >
                从当前试玩恢复到画布
              </button>
              <button
                type="button"
                onClick={() => download(doc, '游戏场景动画声音.json')}
              >
                导出当前创作
              </button>
              <button
                type="button"
                onClick={() => {
                  const local = localStorage.getItem(key);
                  if (local) download(JSON.parse(local), '本地创作备份.json');
                  else setNotice('没有额外的本地草稿。');
                }}
              >
                导出本地备份
              </button>
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  if (dirty && !discardPending) {
                    setDiscardPending(true);
                    return;
                  }
                  setDiscardPending(false);
                  void load();
                }}
              >
                {discardPending && dirty
                  ? '确认放弃未保存修改并载入'
                  : '重新载入服务器版本'}
              </button>
            </div>
            <label>
              导入创作 JSON
              <input
                type="file"
                accept=".json,application/json"
                disabled={locked}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 180000) {
                    setError('创作文件过大。');
                    return;
                  }
                  void file
                    .text()
                    .then((text) => {
                      const parsed = JSON.parse(text);
                      const incoming = parseCreative(parsed.document ?? parsed);
                      commit((d) => Object.assign(d, incoming));
                    })
                    .catch(() => setError('无法导入：创作文件格式有误。'));
                  e.target.value = '';
                }}
              />
            </label>
            <p>
              导入会替换画布内容，可撤销。图片和声音文件仍须属于当前项目；保存时会检查。
            </p>
          </details>
        </>
      )}
    </section>
  );
}
