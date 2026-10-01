import { StudioNav } from '../../../components/StudioNav';
import { CreationReadiness } from '../../../features/creator/CreationReadiness';

export default function CapacityPage() {
  return (
    <>
      <StudioNav active="capacity" />
      <main className="capacity-page">
        <header className="capacity-hero">
          <div>
            <p className="eyebrow">创作环境检查</p>
            <h1>
              Unity 运行时，<span>清晰可控。</span>
            </h1>
            <p>
              检查本地创作服务是否已连接。制作任务的实际进度请在项目的试玩页面查看。
            </p>
          </div>
          <span className="capacity-hero__stamp">
            <small>ENVIRONMENT</small>
            <strong>LOCAL DEVELOPMENT</strong>
            <small>按服务检测结果显示</small>
          </span>
        </header>
        <CreationReadiness />
      </main>
    </>
  );
}
