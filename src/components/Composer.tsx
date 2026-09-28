import { useEffect, useRef, useState, type KeyboardEvent, type CompositionEvent } from 'react';
import { IconSend, IconStop } from './icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: (file?: File) => void;
  onStop: () => void;
  running: boolean;
}

export default function Composer({ value, onChange, onSend, onStop, running }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
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

  const submit = () => {
    if (running) return;
    if (!file && !value.trim()) return;
    onChange('');
    requestAnimationFrame(() => taRef.current && (taRef.current.style.height = 'auto'));
    onSend(file ?? undefined);
    setFile(null);
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
        <textarea
          ref={taRef}
          rows={1}
          value={value}
          placeholder={running ? '图片任务正在后台运行…' : '上传照片，再说说你想怎样重新创作…'}
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
          disabled={running}
        />
        <div className="composer-row">
          <div className="composer-hint">
            <button type="button" className="attach-btn" onClick={() => fileRef.current?.click()} disabled={running}>
              ＋ 图片
            </button>
            <span>先上传图片 · Enter 发送 · Shift+Enter 换行</span>
          </div>
          {running ? (
            <button className="send-btn stop" onClick={onStop} title="停止生成" aria-label="停止生成">
              <IconStop size={17} />
            </button>
          ) : (
            <button
              className="send-btn"
              onClick={submit}
              disabled={!file && !value.trim()}
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
    </div>
  );
}
