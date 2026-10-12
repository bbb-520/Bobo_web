import type { LibraryBook, PhotoBookPage } from './photo-book-pages';
export type PhotoArchivePhoto = {
  src: string;
  alt: string;
  filename: string;
};

/** Read only the configured public author album; objects remain private in OSS. */
export async function fetchPhotoArchive(baseUrl = '', signal?: AbortSignal): Promise<PhotoArchivePhoto[]> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/photo-archive`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || body?.detail || '读取 OSS 相册失败，请稍后重试');
  }
  const files: { filename: string; size: number }[] = await response.json();
  return files.map(({ filename }, index) => ({
    src: `${baseUrl.replace(/\/$/, '')}/api/photo-archive/${encodeURIComponent(filename)}`,
    alt: `作者相册照片 ${String(index + 1).padStart(2, '0')}`,
    filename,
  }));
}

export function createPhotoArchiveBook(photos: PhotoArchivePhoto[]): LibraryBook | null {
  if (photos.length === 0) return null;

  const pages: PhotoBookPage[] = photos.map((photo, index) => ({
    id: `photo-archive-${index + 1}`,
    image: photo.src,
    alt: photo.alt,
    sourceFilename: photo.filename,
    caption: `PHOTO ARCHIVE · ${String(index + 1).padStart(2, '0')}`,
  }));

  return {
    id: 'photo-archive',
    title: 'ONE AND ONE / PHOTO ARCHIVE',
    spineMark: '相册',
    color: '#c8bda8',
    ink: '#315b8f',
    cover: photos[0].src,
    ratio: 0.75,
    spineHeight: 68,
    pages,
  };
}
