import { useEffect, useRef, useState } from 'react';
import { isQqEmail, sendEmailCode, type CodePurpose } from '../lib/auth';
interface Props {
  baseUrl: string;
  purpose: CodePurpose;
  email: string;
  code: string;
  onEmail: (value: string) => void;
  onCode: (value: string) => void;
  disabled?: boolean;
  onSending?: (value: boolean) => void;
}
export default function EmailCodeFields({
  baseUrl,
  purpose,
  email,
  code,
  onEmail,
  onCode,
  disabled = false,
  onSending,
}: Props) {
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (deadline <= Date.now()) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  const send = async () => {
    if (sending || disabled || deadline > Date.now()) return;
    if (!isQqEmail(email)) {
      setError('请输入有效的 QQ 邮箱（@qq.com）');
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setSending(true);
    onSending?.(true);
    setError('');
    setMessage('');
    try {
      const result = await sendEmailCode(
        baseUrl,
        email.trim().toLowerCase(),
        purpose,
        request.signal,
      );
      if (request.signal.aborted) return;
      setNow(Date.now());
      setDeadline(Date.now() + result.resendAfter * 1000);
      setMessage('验证码已发送，5 分钟内有效。请查看邮箱或垃圾邮件。');
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : '验证码发送失败');
    } finally {
      if (!request.signal.aborted) {
        setSending(false);
        onSending?.(false);
      }
    }
  };
  return (
    <div className="email-fields">
      <div className="field">
        <label htmlFor={`qq-email-${purpose}`}>QQ 邮箱</label>
        <input
          id={`qq-email-${purpose}`}
          type="email"
          autoComplete="email"
          value={email}
          placeholder="123456@qq.com"
          disabled={disabled || sending}
          onChange={(e) => {
            onEmail(e.target.value);
            onCode('');
            setMessage('');
            setError('');
          }}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`qq-code-${purpose}`}>邮箱验证码</label>
        <div className="code-input-row">
          <input
            id={`qq-code-${purpose}`}
            value={code}
            onChange={(e) =>
              onCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="6 位数字"
            disabled={disabled || sending}
            required
          />
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void send()}
            disabled={disabled || sending || remaining > 0}
          >
            {sending
              ? '发送中…'
              : remaining > 0
                ? `${remaining}s 后重发`
                : '发送验证码'}
          </button>
        </div>
      </div>
      {message && (
        <div className="hint" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="setup-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
