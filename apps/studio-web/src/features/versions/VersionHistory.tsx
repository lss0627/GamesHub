import { UiIcon } from '../../components/UiIcon';

export function VersionHistory(props: {
  versions: Array<{
    id: string;
    summary: string;
    status: string;
    createdAt: string;
  }>;
  onRestore?: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <section aria-label="版本历史">
      <header className="panel__header">
        <div className="panel__heading">
          <span className="panel__heading-icon">
            <UiIcon name="history" />
          </span>
          <span className="panel__title-group">
            <span className="panel__kicker">Timeline control</span>
            <h2 className="panel__title">版本</h2>
          </span>
        </div>
        <span className="panel__index">
          <strong>{props.versions.length.toString().padStart(2, '0')}</strong>{' '}
          SAVES
        </span>
      </header>
      <div className="resource-panel__body">
        {props.versions.length > 0 ? (
          <ol className="version-list">
            {props.versions.map((version) => (
              <li className="version-list__item" key={version.id}>
                <span className="version-list__name">
                  <strong>{version.summary}</strong>
                  <time
                    className="version-list__meta"
                    dateTime={version.createdAt}
                  >
                    {version.status}
                  </time>
                </span>
                {props.onRestore ? (
                  <button
                    className="version-action"
                    type="button"
                    disabled={props.disabled || version.status === 'active'}
                    onClick={() => props.onRestore?.(version.id)}
                  >
                    恢复
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className="resource-empty">
            <span className="resource-empty__icon">
              <UiIcon name="history" />
            </span>
            <span>
              <strong>还没有版本记录</strong>
              <p>第一次创作成功后，系统会自动保存可恢复节点。</p>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
