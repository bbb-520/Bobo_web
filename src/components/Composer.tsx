import { useEffect, useRef, useState, type KeyboardEvent, type CompositionEvent } from 'react';
import { IconSend, IconStop } from './icons';
import { billingWarningMessage, formatTokens, generationBlockReason, type Wallet } from '../lib/billing';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: (file?: File, kind?:'image'|'chat') => Promise<boolean>;
  wallet:Wallet|null;
  signedIn:boolean;
  onOpenAccount:()=>void;
  onStop: () => void;
  running: boolean;
}

export default function Composer({ value, onChange, onSend, onStop, running, wallet, signedIn, onOpenAccount }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const sendingRef = useRef(false);
  const [checking,setChecking] = useState(false);
  const [kind,setKind] = useState<'image'|'chat'>('image');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    if (!next.type.startsWith('image/')) return;
    if (next.size > 20 * 1024 * 1024) return;
    setFile(next);
  };

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 176) + 'px';
  };

  const blocked = signedIn ? generationBlockReason(wallet, file ? kind === 'image' ? 'IMAGE' : 'VISION' : 'CHAT') : null;
  const submit = async () => {
    if (running || sendingRef.current || blocked || (!file && !value.trim())) return;
    sendingRef.current=true;setChecking(true);
    try { if(await onSend(file ?? undefined,kind)) {onChange('');setFile(null);requestAnimationFrame(()=>taRef.current&&(taRef.current.style.height='auto'));} }
    finally {sendingRef.current=false;setChecking(false);}
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onCompositionStart = (e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = true;
    void e;
  };
  const onCompositionEnd = (e: CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    void e;
  };

  return (
    <div className="composer-wrap">
      <div
        className="composer-inner"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          chooseFile(event.dataTransfer.files?.[0]);
        }}
      >
        {file && (
          <div className="composer-attachment" title={file.name}>
            {previewUrl && <img src={previewUrl} alt="待上传图片预览" />}
            <span>{file.name.length > 22 ? `${file.name.slice(0, 20)}…` : file.name}</span>
            <button type="button" onClick={() => setFile(null)} aria-label="移除图片">×</button>
          </div>
        )}
        <div className="composer-mode"><label htmlFor="creation-mode">照片处理</label><select id="creation-mode" value={kind} onChange={e=>setKind(e.target.value as 'image'|'chat')} disabled={running||checking}><option value="image">直接图片创作</option><option value="chat">先识图再创作</option></select></div>
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder={running ? '正在处理，可点击停止…' : '输入问题，或上传照片进行创作…'}
          onChange={(e) => {
            onChange(e.target.value);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files)[0];
            if (pasted) chooseFile(pasted);
          }}
          disabled={running||checking}
        />
        <div className="composer-row">
          <div className="composer-hint">
            <button type="button" className="attach-btn" onClick={() => fileRef.current?.click()} disabled={running||checking}>
              ＋ 图片
            </button>
            <span>Enter 发送 · Shift+Enter 换行</span>
          </div>
          {running ? (
            <button className="send-btn stop" onClick={onStop} title="停止生成" aria-label="停止生成">
              <IconStop size={17} />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={submit}
              disabled={checking || Boolean(blocked) || (!file && !value.trim())}
              title="发送"
              aria-label="发送"
            >
              <IconSend size={17} style={{ marginLeft: 1 }} />
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.currentTarget.value = '';
          }}
        />
      </div>
      {signedIn&&<div className="composer-billing-note"><span>{blocked ?? (wallet && billingWarningMessage(wallet)) ?? (file&&kind==='image' ? (wallet?.freeImages ? `剩余 ${wallet.freeImages} 次图片试用` : '图片按供应商实际用量计费；未返回 Token 时按图片计费。') : (wallet?.freeTokens ?? 0) > 0 ? `免费额度剩余 ${formatTokens(wallet!.freeTokens!)} Token，优先抵扣实际输入与输出用量。` : '按实际用量扣费；已受理请求停止等待后仍需结算。')}</span><button type="button" onClick={onOpenAccount}>账户 / 充值</button></div>}
    </div>
  );
}
