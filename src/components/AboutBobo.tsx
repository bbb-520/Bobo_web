import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
const BoboFlipbook = lazy(() => import('./BoboFlipbook'));
const CircularGallery = lazy(() => import('./CircularGallery.jsx'));
const DomeGallery = lazy(() => import('./DomeGallery.jsx'));
import { createPhotoArchiveBook, fetchPhotoArchive, type PhotoArchivePhoto } from './photo-archive';
import './bobo-world.css';

type View = 'book' | 'ring' | 'atlas';
const views: View[] = ['book', 'ring', 'atlas'];

function ModeIcon({ view }: { view: View }) {
  if (view === 'book') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5c3.4-.9 5.7-.3 8 1.4v12c-2.3-1.7-4.6-2.3-8-1.4zM20 5.5c-3.4-.9 -5.7-.3 -8 1.4v12c2.3-1.7 4.6-2.3 8-1.4z" /></svg>;
  if (view === 'ring') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 4v5M20 12h-5M12 20v-5M4 12h5" /></svg>;
}

function DomeGallerySurface({ images }: { images: { src: string; alt: string }[] }) {
  return <div className="gallery-surface dome-gallery-surface"><DomeGallery images={images} grayscale={false} overlayBlurColor="#ffffff" /></div>;
}

interface Props {
  onBack: () => void;
  onStart: () => void;
  baseUrl?: string;
}

export default function AboutBobo({ onBack, onStart, baseUrl = '' }: Props) {
  const [view, setView] = useState<View>('book');
  const [photos, setPhotos] = useState<PhotoArchivePhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const archiveBook = useMemo(() => createPhotoArchiveBook(photos), [photos]);
  const circularGalleryItems = useMemo(() => photos.map((photo, index) => ({
    image: photo.src,
    text: 'PHOTO ' + String(index + 1).padStart(2, '0'),
  })), [photos]);
  const domeGalleryImages = useMemo(() => photos.map((photo) => ({ src: photo.src, alt: photo.alt })), [photos]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchPhotoArchive(baseUrl, controller.signal)
      .then((nextPhotos) => {
        if (!controller.signal.aborted) {
          console.debug('[about-bobo] author archive loaded', { count: nextPhotos.length });
          setPhotos(nextPhotos);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          console.error('[about-bobo] author archive request failed', cause);
          setError(cause instanceof Error ? cause.message : '读取作者相册失败');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [baseUrl]);

  return (
    <div className="bobo-world about-3d-world">
      <header className="world-header about-3d-header">
        <button type="button" onClick={onBack} className="world-icon-button" aria-label="返回开始页" title="返回开始页">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        </button>
        <span aria-hidden="true" />
        <button type="button" onClick={onStart} className="world-icon-button" aria-label="打开聊天" title="打开聊天">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3z" /><path d="M8 10h.01M12 10h.01M16 10h.01" /></svg>
        </button>
      </header>

      <nav className="world-dock" aria-label="3D 相册视图">
        {views.map((item) => (
          <button
            type="button"
            key={item}
            className={view === item ? 'is-active' : ''}
            onClick={() => setView(item)}
            aria-label={item === 'book' ? '书本翻页' : item === 'ring' ? '环形相册' : '星图相册'}
            aria-pressed={view === item}
          >
            <ModeIcon view={item} />
          </button>
        ))}
      </nav>

      <main className="world-main about-3d-main" aria-label="关于bbb 3D 相册">
        {loading ? (
          <div className="world-view-loading" role="status" aria-label="正在加载" />
        ) : error ? (
          <div className="world-view-loading" role="alert">{error}</div>
        ) : photos.length === 0 ? (
          <div className="world-view-loading" role="status" aria-label="暂无图片" />
        ) : (
          <Suspense fallback={<div className="world-view-loading" role="status" aria-label="正在打开 3D 相册" />}>
            {view === 'book' ? (
              <div className="world-book"><BoboFlipbook book={archiveBook ?? undefined} /></div>
            ) : view === 'ring' ? (
              <div className="gallery-surface circular-gallery-surface">
                <CircularGallery items={circularGalleryItems} bend={3} textColor="#263128" borderRadius={0.05} scrollEase={0.02} fontUrl="https://fonts.googleapis.com/css2?family=Orbitron:wght@700&display=swap" font="bold 30px Orbitron" />
              </div>
            ) : (
              <DomeGallerySurface images={domeGalleryImages} />
            )}
          </Suspense>
        )}
      </main>
    </div>
  );
}
