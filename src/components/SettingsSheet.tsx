import type { Settings } from '../types';
import { logout, type AuthUser } from '../lib/auth';
import { IconClose } from './icons';

interface Props {
  settings: Settings;
  onChange: (s: Partial<Settings>) => void;
  onClose: () => void;
  user: AuthUser | null;
  onLoggedOut: () => void;
}

export default function SettingsSheet({ settings, onChange, onClose, user, onLoggedOut }: Props) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="sheet settings-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <span className="profile-kicker">BOBO / SETTINGS</span>
            <h2>设置</h2>
          </div>
          <button className="icon-btn light" onClick={onClose} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>
        <div className="sheet-sub">调整页面背景，邮箱、余额和充值在用户页统一管理。</div>

        <div className="set-sec">
          <div className="set-sec-title">页面背景</div>
          <div className="theme-grid" role="group" aria-label="选择页面背景">
            <button
              type="button"
              className={`theme-card${settings.theme === 'light' ? ' sel' : ''}`}
              onClick={() => onChange({ theme: 'light' })}
            >
              <span className="theme-swatch theme-swatch-light" aria-hidden="true" />
              <span><strong>白色模式</strong><small>明亮、清晰的画布</small></span>
            </button>
            <button
              type="button"
              className={`theme-card${settings.theme === 'dark' ? ' sel' : ''}`}
              onClick={() => onChange({ theme: 'dark' })}
            >
              <span className="theme-swatch theme-swatch-dark" aria-hidden="true" />
              <span><strong>黑色模式</strong><small>低亮度的夜间画布</small></span>
            </button>
          </div>
        </div>

        <div className="set-sec settings-account">
          <div className="set-sec-title">当前账号</div>
          <div className="hint">{user ? `已登录：${user.username}` : '当前未登录'}</div>
          {user && (
            <button className="btn-ghost danger" type="button" onClick={() => { void logout(settings.baseUrl).then(onLoggedOut); }}>
              退出登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
