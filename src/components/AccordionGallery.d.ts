import type { ComponentType } from 'react';

export interface AccordionGalleryItem {
  id?: string;
  image: string;
  label: string;
  alt?: string;
}

declare const AccordionGallery: ComponentType<{
  items: AccordionGalleryItem[];
  defaultIndex?: number;
  accentColor?: string;
  overlayColor?: string;
  textColor?: string;
  height?: number;
  gap?: number;
  radius?: number;
  expandRatio?: number;
  trigger?: 'hover' | 'click';
  showLabels?: boolean;
  grayscale?: boolean;
  onActiveChange?: (index: number) => void;
}>;

export default AccordionGallery;
