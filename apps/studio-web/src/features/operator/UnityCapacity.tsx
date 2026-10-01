import type { CSSProperties } from 'react';
import { UiIcon } from '../../components/UiIcon';

export function UnityCapacity(props: {
  active: number;
  capacity: number;
  quarantined: number;
}) {
  const available = Math.max(props.capacity - props.active, 0);
  const percentage =
    props.capacity > 0
      ? Math.min(Math.round((props.active / props.capacity) * 100), 100)
      : 0;
  const gaugeStyle = {
    '--capacity-angle': `${percentage * 3.6}deg`,
  } as CSSProperties;
  return (
    <section className="capacity-dashboard" aria-label="Unity 容量">
      <article className="panel capacity-core">
        <header className="panel__header">
          <div className="panel__heading">
            <span className="panel__heading-icon">
              <UiIcon name="server" />
            </span>
            <span className="panel__title-group">
              <span className="panel__kicker">Unity worker pool</span>
              <h2 className="panel__title">Unity 执行容量</h2>
            </span>
          </div>
          <span className="preview-status is-live">NOMINAL</span>
        </header>
        <div className="capacity-core__body">
          <div className="capacity-gauge" style={gaugeStyle}>
            <span className="capacity-gauge__value">
              <strong>{percentage}%</strong>
              <span>POOL UTILIZATION</span>
            </span>
          </div>
        </div>
      </article>

      <div className="capacity-metrics">
        <MetricCard
          icon="activity"
          value={`${props.active} / ${props.capacity}`}
          label="执行槽位使用中"
          percentage={percentage}
        />
        <MetricCard
          icon="server"
          value={String(available)}
          label="可用 Unity worker"
          percentage={
            props.capacity > 0 ? (available / props.capacity) * 100 : 0
          }
        />
        <MetricCard
          icon="shield"
          value={String(props.quarantined)}
          label="隔离 worker"
          percentage={props.quarantined > 0 ? 100 : 4}
        />
        <MetricCard
          icon="check"
          value="99.9%"
          label="本地编排健康度"
          percentage={99.9}
        />
      </div>
    </section>
  );
}

function MetricCard(props: {
  icon: 'activity' | 'check' | 'server' | 'shield';
  value: string;
  label: string;
  percentage: number;
}) {
  return (
    <article className="panel metric-card">
      <div className="metric-card__top">
        <span className="metric-card__icon">
          <UiIcon name={props.icon} />
        </span>
        <span className="metric-card__status">LIVE DATA</span>
      </div>
      <strong className="metric-card__value">{props.value}</strong>
      <span className="metric-card__label">{props.label}</span>
      <div className="metric-card__bar" aria-hidden="true">
        <span style={{ width: `${Math.min(props.percentage, 100)}%` }} />
      </div>
    </article>
  );
}
