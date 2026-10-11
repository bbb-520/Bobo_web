import { useEffect, useState } from 'react';
import { getImageReceipt, type ZineResult } from '../lib/zine';
interface Props {
  baseUrl: string;
  requestId: string;
  initial?: ZineResult;
  onRemix?: (url: string) => void;
}
export default function ZineResultCard({
  baseUrl,
  requestId,
  initial,
  onRemix,
}: Props) {
  const [result, setResult] = useState<ZineResult | undefined>(initial);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (initial && version === 0) return;
    const controller = new AbortController();
    getImageReceipt(baseUrl, requestId, controller.signal)
      .then(setResult)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '结果恢复失败');
      });
    return () => controller.abort();
  }, [baseUrl, requestId, initial, version]);
  const url = result?.result.imageUrl;
  const safe = Boolean(url && /^https?:\/\//i.test(url));
  return (
    <section className="zine-result" aria-label="图片创作结果">
      {safe && (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt="图片创作结果"
            onError={() =>
              setError('图片链接可能已过期，请刷新回执或联系运营恢复。')
            }
          />
        </a>
      )}
      {result?.result.rationale && <p>{result.result.rationale}</p>}
      <div className="account-actions">
        {safe && (
          <>
            <a
              className="btn-ghost"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              查看 / 保存图片
            </a>
            {onRemix && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => onRemix?.(url!)}
              >
                继续创作
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setError('');
            setVersion((v) => v + 1);
          }}
        >
          刷新生成回执
        </button>
      </div>
      {!result && !error && <p role="status">正在恢复生成结果…</p>}
      {error && (
        <p className="setup-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
