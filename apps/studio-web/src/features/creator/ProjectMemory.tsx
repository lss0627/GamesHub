'use client';

import { useEffect, useState } from 'react';
import { readApiResponse } from './api-response';

type Kind = 'preference' | 'constraint' | 'decision';
type Item = {
  id: string;
  kind: Kind;
  content: string;
  revision: number;
  source: string;
};
type Document = {
  revision: number;
  items: Item[];
  derived?: { confirmedSpecId?: string };
};
const labels = {
  preference: '我的偏好',
  constraint: '必须遵守',
  decision: '已经决定',
};
const errors = {
  MEMORY_CHANGED: '记录已在另一处更新，已重新加载。请检查后再保存。',
  MEMORY_INPUT_INVALID: '请填写 1–1200 字的记录。',
  MEMORY_LIMIT: '记录已达到上限，请合并现有记录。',
  MEMORY_NOT_FOUND: '这条记录已经被删除，请刷新后再试。',
};
async function readMemory(response: Response): Promise<Document> {
  const value = await readApiResponse<Document>(response, errors);
  if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.items))
    throw new Error('项目记忆暂时未加载，请重新加载。');
  return value;
}

export function ProjectMemory({ projectId }: { projectId: string }) {
  const [document, setDocument] = useState<Document>();
  const [content, setContent] = useState('');
  const [kind, setKind] = useState<Kind>('preference');
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const url = `/v1/projects/${projectId}/agent/memory`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(readMemory)
      .then(setDocument)
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('项目记忆暂时未加载，请重新加载。');
      });
    return () => controller.abort();
  }, [url]);
  async function reload() {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      setDocument(await readMemory(response));
    } catch {
      setMessage('项目记忆暂时未加载，请稍后重试。');
    }
  }
  async function change(operation: 'upsert' | 'delete', id?: string) {
    if (!document || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          revision: document.revision,
          operation,
          ...(id ? { id } : {}),
          ...(operation === 'upsert' ? { content, kind } : {}),
        }),
      });
      if (response.status === 409) await reload();
      setDocument({ ...document, ...(await readMemory(response)) });
      if (operation === 'upsert' || id === editing) {
        setContent('');
        setEditing(undefined);
      }
      setMessage(
        operation === 'delete'
          ? '已删除，后续对话不会再把它作为项目记忆。'
          : '已记住，下次讨论会参考这条记录。',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '保存失败，输入已保留。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="studio-memory">
      <summary>
        <span>项目记忆</span>
        <small>
          {document
            ? `${document.items.length} 条 · 可查看和纠正`
            : '偏好与已做的决定'}
        </small>
      </summary>
      <p>
        把不希望反复解释的偏好记在这里。制作说明仍需你确认；改记忆不会直接改动游戏。
      </p>
      {document?.derived?.confirmedSpecId && (
        <p className="studio-memory-source">
          已确认的制作说明也会自动提供给制作伙伴。
        </p>
      )}
      <ul>
        {document?.items.map((item) => (
          <li key={item.id}>
            <div>
              <small>{labels[item.kind]} · 你明确记录</small>
              <p>{item.content}</p>
            </div>
            <div className="studio-memory-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(item.id);
                  setKind(item.kind);
                  setContent(item.content);
                }}
              >
                修改
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`删除记忆：${item.content}`}
                onClick={() => void change('delete', item.id)}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {document && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void change('upsert', editing);
          }}
        >
          <label>
            记录类型
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
            >
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {editing ? '修改这条记忆' : '希望伙伴记住什么'}
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={1200}
              required
              placeholder="例如：面向第一次玩游戏的人，失败后可以立即重试。"
            />
          </label>
          <div className="studio-memory-actions">
            <button type="submit" disabled={busy || !content.trim()}>
              {busy ? '正在保存…' : editing ? '保存修改' : '记住这条'}
            </button>
            {editing && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setEditing(undefined);
                  setContent('');
                }}
              >
                取消修改
              </button>
            )}
          </div>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      {!document && (
        <button type="button" onClick={() => void reload()}>
          重新加载记忆
        </button>
      )}
    </details>
  );
}
