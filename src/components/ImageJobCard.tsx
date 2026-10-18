import { useEffect, useRef, useState } from 'react';
import type { ImageJobRef } from '../types';
import { apiUrl, fetchImageJob, publishBoboItem } from '../lib/api';
import { ImageJobNotFoundError } from '../lib/imageJobPolling';
import { IconClose, IconDownload, IconUpload } from './icons';
import './image-job.css';

export function ImageJobCard({ job, baseUrl, signedIn, onManage, onRemix }: {
  job: ImageJobRef;
  baseUrl: string;
  signedIn: boolean;
  onManage: () => void;
  onRemix?: (imageUrl: string) => void;
}) {
  const running = job.status === 'QUEUED' || job.status === 'PROCESSING';
  const [imageUrl, setImageUrl] = useState(job.status==='SUCCEEDED'?job.imageUrl??'':'');
  const [publishOpen, setPublishOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [anonymous, setAnonymous] = useState(true);
  const [publishBusy, setPublishBusy] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState('');
  const refreshRef=useRef<(()=>Promise<void>)|null>(null);

  useEffect(()=>{
    const controller=new AbortController();let attempted=false,pending=false;
    const unavailable='图片暂时无法读取，请稍后刷新会话。';
    const refresh=async()=>{
      if(controller.signal.aborted)return;
      if(attempted){if(!pending)setError(unavailable);return;}
      attempted=true;pending=true;
      try {
        const refreshed=await fetchImageJob(job.jobId,baseUrl,controller.signal);
        if(controller.signal.aborted)return;
        if(refreshed?.jobId===job.jobId&&refreshed.status==='SUCCEEDED'&&refreshed.imageUrl
          &&(!job.requestId||!refreshed.requestId||job.requestId===refreshed.requestId)) {
          setImageUrl(refreshed.imageUrl);setError('');
        } else setError(unavailable);
      } catch(cause) {
        if(!controller.signal.aborted)setError(cause instanceof ImageJobNotFoundError?'图片任务已失效，请重新上传图片。':unavailable);
      } finally {pending=false;}
    };
    refreshRef.current=refresh;
    setImageUrl(job.status==='SUCCEEDED'?job.imageUrl??'':'');setError('');
    if(job.status==='SUCCEEDED'&&!job.imageUrl)void refresh();
    return()=>{controller.abort();if(refreshRef.current===refresh)refreshRef.current=null;};
  },[job.jobId,job.requestId,job.status,job.imageUrl,baseUrl]);

  const refreshImageUrl=()=>refreshRef.current?.();

  const downloadImage = () => {
    if (!imageUrl || job.status !== 'SUCCEEDED') return;
    const anchor = document.createElement('a');
    anchor.href = apiUrl(`/api/image-jobs/${encodeURIComponent(job.jobId)}/download`, baseUrl);
    anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.download = `bobo-${job.jobId}.png`;
    document.body.append(anchor); anchor.click(); anchor.remove();
  };

  const publish = async () => {
    if (!signedIn || job.status !== 'SUCCEEDED' || publishBusy) return;
    setPublishBusy(true); setError('');
    try {
      await publishBoboItem(baseUrl, { jobId: job.jobId, caption: caption.trim() || null, anonymous });
      setPublished(true); setPublishOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '发布失败，请重试');
    } finally { setPublishBusy(false); }
  };

  if (running) return <div className="image-job-pending" aria-live="polite"><span className="image-job-scan" aria-hidden="true" /><div><strong>正在生成一张图片</strong><p>完成后结果会显示在这里。</p></div></div>;
  if (!imageUrl) return <div className="image-job-pending" role="alert"><div><strong>{job.status==='SUCCEEDED'?(error?'图片暂时无法读取':'正在恢复图片'):'图片生成未完成'}</strong><p>{error || job.error || (job.status==='SUCCEEDED'?'正在获取图片，请稍候。':'请稍后重试。')}</p></div></div>;

  return (
    <section className="image-job-card" aria-label="生成图片">
      <div className="image-job-result-wrap">
        <a className="image-job-result" href={imageUrl} target="_blank" rel="noreferrer">
          <img src={imageUrl} alt="图片二次生成结果" loading="lazy" onError={() => void refreshImageUrl()} />
        </a>
        <div className="image-job-actions" aria-label="图片操作">
          <button type="button" className="image-action-btn" onClick={() => setPublishOpen(true)} disabled={!signedIn || published} title={published ? '已加入 Bobo’s World' : !signedIn ? '登录后可以发布作品' : '上传 Bobo’s World'} aria-label={published ? '已上传到 Bobo’s World' : '上传到 Bobo’s World'}>
            <IconUpload size={17} /><span>{published ? '已上传' : '上传到 Bobo’s World'}</span>
          </button>
          <button type="button" className="image-action-btn" onClick={downloadImage} title="下载到本地" aria-label="下载图片到本地">
            <IconDownload size={17} /><span>下载到本地</span>
          </button>
          {onRemix && <button type="button" className="image-action-btn" onClick={() => onRemix(imageUrl)} title="继续二次创作">继续二创</button>}
          {published && <button type="button" className="image-action-btn" onClick={onManage}>管理作品</button>}
        </div>
      </div>
      {error && <p className="image-job-error" role="alert">{error}</p>}

      {publishOpen && <div className="bobo-publish-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !publishBusy) setPublishOpen(false); }}>
        <section className="bobo-publish-dialog" role="dialog" aria-modal="true" aria-labelledby={`publish-title-${job.jobId}`}>
          <button type="button" className="bobo-publish-close" onClick={() => setPublishOpen(false)} aria-label="关闭发布确认" disabled={publishBusy}><IconClose size={16} /></button>
          <span className="profile-kicker">BOBO’S WORLD</span>
          <h3 id={`publish-title-${job.jobId}`}>确认加入 Bobo’s World</h3>
          <p>确认后，所有访客都可以看到这张生成结果图。原始上传照片不会公开。</p>
          <label>作品文案（可选）<textarea maxLength={500} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="写一句作品说明" /></label>
          <label className="bobo-publish-anonymous"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />匿名展示</label>
          <div className="bobo-publish-actions"><button type="button" onClick={() => setPublishOpen(false)} disabled={publishBusy}>取消</button><button type="button" onClick={() => void publish()} disabled={publishBusy}>{publishBusy ? '正在上传…' : '确认加入'}</button></div>
        </section>
      </div>}
    </section>
  );
}
