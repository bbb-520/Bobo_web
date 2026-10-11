import type { LibraryBook, PhotoBookPage } from './photo-book-pages';
import memory01 from '../assets/memory-01.jpg';
import memory02 from '../assets/memory-02.jpg';
import memory03 from '../assets/memory-03.jpg';
import memory04 from '../assets/memory-04.jpg';
import memory05 from '../assets/memory-05.jpg';
import memory06 from '../assets/memory-06.jpg';

export type PhotoArchivePhoto = {
  src: string;
  alt: string;
  filename: string;
};

/** The current backend has no public photo-archive route; use the bundled author set. */
export async function fetchPhotoArchive(_baseUrl = '', signal?: AbortSignal): Promise<PhotoArchivePhoto[]> {
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
  return [memory01, memory02, memory03, memory04, memory05, memory06].map((src, index) => ({
    src,
    alt: `作者相册照片 ${String(index + 1).padStart(2, '0')}`,
    filename: `memory-${String(index + 1).padStart(2, '0')}.jpg`,
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
