import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  login,
  register,
  emailLogin,
  getMe,
  isQqEmail,
  type AuthUser,
} from '../lib/auth';
import EmailCodeFields from './EmailCodeFields';
import { IconClose } from './icons';
interface Props {
  baseUrl: string;
  onLoggedIn: (user: AuthUser) => void;
  onClose: () => void;
}
type Mode = 'login' | 'email' | 'register';
export default function SetupGuide({ baseUrl, onLoggedIn, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', escape);
      controller.current?.abort();
    };
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (lock.current || sending) return;
    setError('');
    if (mode !== 'login' && (!isQqEmail(email) || !/^\d{6}$/.test(code))) {
      setError('请填写 QQ 邮箱和 6 位验证码');
      return;
    }
    if (mode !== 'email' && (!username.trim() || !password)) {
      setError('请填写用户名和密码');
      return;
    }
    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    lock.current = true;
    setBusy(true);
    const request = new AbortController();
    controller.current = request;
    let registered = false;
    try {
      if (mode === 'register') {
        await register(
          baseUrl,
          username.trim(),
          password,
          email.trim().toLowerCase(),
          code,
          request.signal,
        );
        registered = true;
      }
      if (mode === 'email')
        await emailLogin(
          baseUrl,
          email.trim().toLowerCase(),
          code,
          request.signal,
        );
      else await login(baseUrl, username.trim(), password, request.signal);
      const user = await getMe(baseUrl, request.signal);
      if (!request.signal.aborted) onLoggedIn(user);
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(
          registered
            ? '注册成功，请使用密码登录。'
            : cause instanceof Error
              ? cause.message
              : '登录失败，请稍后重试',
        );
        if (registered) {
          setMode('login');
          setCode('');
        }
      }
    } finally {
      lock.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  };
  return (
    <div
      className="setup-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="setup-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-login-title"
      >
        <div className="setup-guide-orb" aria-hidden="true" />
        <button
          className="icon-btn light setup-close"
          onClick={onClose}
          aria-label="关闭"
        >
          <IconClose size={17} />
        </button>
        <div className="setup-kicker">WELCOME TO BOBO</div>
        <h2 id="account-login-title">
          {mode === 'register' ? '创建 bobo 账号' : '登录 bobo'}
        </h2>
        <p className="setup-sub">
          {mode === 'register'
            ? '验证 QQ 邮箱，新用户注册后获得 100 万 Token 免费额度。'
            : '登录后继续创作；对话与识图优先使用免费 Token 额度。'}
        </p>
        <div className="account-tabs" role="group" aria-label="登录方式">
          {(
            [
              ['login', '密码登录'],
              ['email', '邮箱登录'],
              ['register', '注册'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={busy || sending}
              onClick={() => {
                setMode(value);
                setError('');
                setCode('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <form className="setup-fields" onSubmit={(e) => void submit(e)}>
          {mode !== 'email' && (
            <>
              <div className="field">
                <label htmlFor="account-username">用户名</label>
                <input
                  id="account-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  disabled={busy}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="account-password">密码</label>
                <input
                  id="account-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={
                    mode === 'register' ? 'new-password' : 'current-password'
                  }
                  minLength={8}
                  disabled={busy}
                  required
                />
              </div>
            </>
          )}
          {mode === 'register' && (
            <div className="field">
              <label htmlFor="account-confirm">确认密码</label>
              <input
                id="account-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
                required
              />
            </div>
          )}
          {mode !== 'login' && (
            <EmailCodeFields
              key={mode}
              baseUrl={baseUrl}
              purpose={mode === 'register' ? 'REGISTER' : 'LOGIN'}
              email={email}
              code={code}
              onEmail={setEmail}
              onCode={setCode}
              disabled={busy}
              onSending={setSending}
            />
          )}
          {error && (
            <div className="setup-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="setup-primary"
            type="submit"
            disabled={busy || sending}
          >
            {busy ? '处理中…' : mode === 'register' ? '注册并登录' : '登录'}
          </button>
        </form>
      </section>
    </div>
  );
}
