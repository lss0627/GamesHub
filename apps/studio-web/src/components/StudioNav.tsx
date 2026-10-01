import { UiIcon } from './UiIcon';

export function StudioNav(props: {
  active?: 'create' | 'capacity';
  status?: 'checking' | 'ready' | 'degraded' | 'offline';
}) {
  const status = props.status ?? 'checking';
  const labels = {
    checking: '正在连接',
    ready: '链路就绪',
    degraded: '降级运行',
    offline: '服务离线',
  };
  return (
    <header className="studio-nav">
      <a className="brand" href="/" aria-label="GamerHub 首页">
        <span className="brand__mark" aria-hidden="true">
          <span className="brand__core" />
        </span>
        <span className="brand__wordmark">
          GAMER<span>HUB</span>
        </span>
        <span className="brand__edition">AI STUDIO</span>
      </a>

      <nav className="studio-nav__links" aria-label="主要导航">
        <a
          href="/"
          className={props.active === 'create' ? 'is-active' : undefined}
        >
          创作空间
        </a>
        <a href="/#assets">资产模块</a>
        <a
          href="/operator/capacity"
          className={props.active === 'capacity' ? 'is-active' : undefined}
        >
          系统容量
        </a>
      </nav>

      <div
        className="node-status"
        data-status={status}
        title={`本地开发节点：${labels[status]}`}
      >
        <span className="node-status__pulse" />
        <span className="node-status__copy">
          <small>LOCAL NODE</small>
          <strong>{labels[status]}</strong>
        </span>
        <UiIcon name="activity" />
      </div>
    </header>
  );
}
