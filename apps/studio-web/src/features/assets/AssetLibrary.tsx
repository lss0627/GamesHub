import { useRef, useState } from 'react';
import { UiIcon } from '../../components/UiIcon';

export function AssetLibrary(props: {
  disabled?: boolean;
  assets: Array<{ id: string; name: string; importStatus: string }>;
  onUpload?: (file: File) => void;
  onReplace?: (assetId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [licenseConfirmed, setLicenseConfirmed] = useState(false);
  return (
    <section id="assets" className="panel resource-panel" aria-label="素材库">
      <header className="panel__header">
        <div className="panel__heading">
          <span className="panel__heading-icon">
            <UiIcon name="image" />
          </span>
          <span className="panel__title-group">
            <span className="panel__kicker">Asset module</span>
            <h2 className="panel__title">素材</h2>
          </span>
        </div>
        <span className="panel__index">
          <strong>{props.assets.length.toString().padStart(2, '0')}</strong>{' '}
          ITEMS
        </span>
      </header>
      <div className="resource-panel__body">
        <label className="asset-license">
          <input
            type="checkbox"
            aria-label="我确认拥有素材授权"
            checked={licenseConfirmed}
            onChange={(event) =>
              setLicenseConfirmed(event.currentTarget.checked)
            }
          />
          我确认拥有或获得了该素材的使用授权
        </label>
        <div className="asset-uploader">
          <div className="asset-uploader__copy">
            <span className="asset-uploader__icon">
              <UiIcon name="upload" />
            </span>
            <span>
              <strong>导入角色与场景素材</strong>
              <p>PNG / JPEG / WEBP · HASH VERIFIED</p>
            </span>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!props.onUpload || !licenseConfirmed}
          >
            <UiIcon name="upload" /> 上传素材
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="选择素材"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) props.onUpload?.(file);
              event.currentTarget.value = '';
            }}
          />
        </div>
        {props.assets.length > 0 ? (
          <ul className="asset-list">
            {props.assets.map((asset) => (
              <li className="asset-list__item" key={asset.id}>
                <span className="asset-list__name">
                  <strong>{asset.name}</strong>
                  <span className="asset-list__status">
                    {asset.importStatus}
                  </span>
                </span>
                <button
                  className="asset-action"
                  type="button"
                  onClick={() => props.onReplace?.(asset.id)}
                  disabled={
                    props.disabled ||
                    !props.onReplace ||
                    asset.importStatus === 'failed'
                  }
                >
                  应用到角色 <UiIcon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="resource-empty">
            <span className="resource-empty__icon">
              <UiIcon name="image" />
            </span>
            <span>
              <strong>素材舱为空</strong>
              <p>完成授权确认后即可注入你的视觉资产。</p>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
