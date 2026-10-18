import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { gsap } from 'gsap';
import './PillNav.css';

export interface PillNavItem {
  label: string;
  href?: string;
  ariaLabel?: string;
  onClick?: () => void;
}

interface Props {
  logo: string;
  logoAlt?: string;
  items: PillNavItem[];
  activeHref?: string;
  className?: string;
  ease?: string;
  baseColor?: string;
  pillColor?: string;
  hoveredPillTextColor?: string;
  pillTextColor?: string;
  onMobileMenuClick?: () => void;
  initialLoadAnimation?: boolean;
}

/** React Bits PillNav (JS-CSS variant), adapted to the app's hash navigation. */
export default function PillNav({
  logo,
  logoAlt = 'Logo',
  items,
  activeHref,
  className = '',
  ease = 'power3.easeOut',
  baseColor = '#fff',
  pillColor = '#120F17',
  hoveredPillTextColor = '#120F17',
  pillTextColor,
  onMobileMenuClick,
  initialLoadAnimation = true,
}: Props) {
  const resolvedPillTextColor = pillTextColor ?? baseColor;
  const menuId = useId();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const circleRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const tlRefs = useRef<gsap.core.Timeline[]>([]);
  const activeTweenRefs = useRef<gsap.core.Tween[]>([]);
  const logoImgRef = useRef<HTMLImageElement | null>(null);
  const logoTweenRef = useRef<gsap.core.Tween | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement | null>(null);
  const navItemsRef = useRef<HTMLDivElement | null>(null);
  const logoRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const layout = () => {
      circleRefs.current.forEach((circle) => {
        if (!circle?.parentElement) return;

        const pill = circle.parentElement;
        const rect = pill.getBoundingClientRect();
        const { width: w, height: h } = rect;
        if (!w || !h) return;
        const radius = ((w * w) / 4 + h * h) / (2 * h);
        const diameter = Math.ceil(2 * radius) + 2;
        const delta = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - (w * w) / 4))) + 1;
        const originY = diameter - delta;

        circle.style.width = `${diameter}px`;
        circle.style.height = `${diameter}px`;
        circle.style.bottom = `-${delta}px`;
        gsap.set(circle, { xPercent: -50, scale: 0, transformOrigin: `50% ${originY}px` });

        const label = pill.querySelector<HTMLElement>('.pill-label');
        const hoveredLabel = pill.querySelector<HTMLElement>('.pill-label-hover');
        if (label) gsap.set(label, { y: 0 });
        if (hoveredLabel) gsap.set(hoveredLabel, { y: h + 12, opacity: 0 });

        const index = circleRefs.current.indexOf(circle);
        if (index === -1) return;
        tlRefs.current[index]?.kill();

        const timeline = gsap.timeline({ paused: true });
        timeline.to(circle, { scale: 1.2, xPercent: -50, duration: 2, ease, overwrite: 'auto' }, 0);
        if (label) timeline.to(label, { y: -(h + 8), duration: 2, ease, overwrite: 'auto' }, 0);
        if (hoveredLabel) {
          gsap.set(hoveredLabel, { y: Math.ceil(h + 100), opacity: 0 });
          timeline.to(hoveredLabel, { y: 0, opacity: 1, duration: 2, ease, overwrite: 'auto' }, 0);
        }
        tlRefs.current[index] = timeline;
      });
    };

    layout();
    window.addEventListener('resize', layout);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(layout);
    if (navItemsRef.current) observer?.observe(navItemsRef.current);
    document.fonts?.ready.then(layout).catch(() => {});

    const menu = mobileMenuRef.current;
    if (menu) gsap.set(menu, { visibility: 'hidden', opacity: 0, scaleY: 1 });

    if (initialLoadAnimation) {
      const logoElement = logoRef.current;
      const navItems = navItemsRef.current;
      if (logoElement) {
        gsap.set(logoElement, { scale: 0 });
        gsap.to(logoElement, { scale: 1, duration: 0.6, ease });
      }
      if (navItems) {
        gsap.set(navItems, { width: 0, overflow: 'hidden' });
        gsap.to(navItems, { width: 'auto', duration: 0.6, ease });
      }
    }

    return () => {
      window.removeEventListener('resize', layout);
      observer?.disconnect();
      tlRefs.current.forEach((timeline) => timeline.kill());
      activeTweenRefs.current.forEach((tween) => tween.kill());
    };
  }, [ease, initialLoadAnimation]);

  const handleEnter = (index: number) => {
    const timeline = tlRefs.current[index];
    if (!timeline) return;
    activeTweenRefs.current[index]?.kill();
    activeTweenRefs.current[index] = timeline.tweenTo(timeline.duration(), { duration: 0.3, ease, overwrite: 'auto' });
  };

  const handleLeave = (index: number) => {
    const timeline = tlRefs.current[index];
    if (!timeline) return;
    activeTweenRefs.current[index]?.kill();
    activeTweenRefs.current[index] = timeline.tweenTo(0, { duration: 0.2, ease, overwrite: 'auto' });
  };

  const handleLogoEnter = () => {
    const image = logoImgRef.current;
    if (!image) return;
    logoTweenRef.current?.kill();
    gsap.set(image, { rotate: 0 });
    logoTweenRef.current = gsap.to(image, { rotate: 360, duration: 0.2, ease, overwrite: 'auto' });
  };

  const animateMobileMenu = (open: boolean) => {
    setIsMobileMenuOpen(open);
    const hamburger = hamburgerRef.current;
    const menu = mobileMenuRef.current;

    if (hamburger) {
      const lines = hamburger.querySelectorAll('.hamburger-line');
      gsap.to(lines[0], { rotation: open ? 45 : 0, y: open ? 3 : 0, duration: 0.3, ease });
      gsap.to(lines[1], { rotation: open ? -45 : 0, y: open ? -3 : 0, duration: 0.3, ease });
    }

    if (!menu) return;
    if (open) {
      gsap.set(menu, { visibility: 'visible' });
      gsap.fromTo(menu, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, ease });
      return;
    }
    gsap.to(menu, {
      opacity: 0,
      y: 10,
      duration: 0.2,
      ease,
      onComplete: () => gsap.set(menu, { visibility: 'hidden' }),
    });
  };

  const handleItemClick = (item: PillNavItem, event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
    if (item.onClick) {
      event.preventDefault();
      item.onClick();
    }
  };

  const toggleMobileMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    animateMobileMenu(!isMobileMenuOpen);
    onMobileMenuClick?.();
  };

  const cssVars = {
    '--base': baseColor,
    '--pill-bg': pillColor,
    '--hover-text': hoveredPillTextColor,
    '--pill-text': resolvedPillTextColor,
  } as CSSProperties;

  return (
    <div className="pill-nav-container">
      <nav className={`pill-nav ${className}`} aria-label="Primary" style={cssVars}>
        <a
          className="pill-logo"
          href={items[0]?.href ?? '#'}
          aria-label="Home"
          onClick={(event) => handleItemClick(items[0] ?? { label: '' }, event)}
          onMouseEnter={handleLogoEnter}
          ref={logoRef}
        >
          <img src={logo} alt={logoAlt} ref={logoImgRef} />
        </a>

        <div className="pill-nav-items desktop-only" ref={navItemsRef}>
          <ul className="pill-list" role="menubar">
            {items.map((item, index) => (
              <li key={item.href || `item-${index}`} role="none">
                <a
                  role="menuitem"
                  href={item.href || '#'}
                  className={`pill${activeHref === item.href ? ' is-active' : ''}`}
                  aria-label={item.ariaLabel || item.label}
                  onClick={(event) => handleItemClick(item, event)}
                  onMouseEnter={() => handleEnter(index)}
                  onMouseLeave={() => handleLeave(index)}
                >
                  <span className="hover-circle" aria-hidden="true" ref={(element) => { circleRefs.current[index] = element; }} />
                  <span className="label-stack">
                    <span className="pill-label">{item.label}</span>
                    <span className="pill-label-hover" aria-hidden="true">{item.label}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <button
          type="button"
          className="mobile-menu-button mobile-only"
          onClick={toggleMobileMenu}
          aria-label={isMobileMenuOpen ? '关闭菜单' : '打开菜单'}
          aria-expanded={isMobileMenuOpen}
          aria-controls={menuId}
          ref={hamburgerRef}
        >
          <span className="hamburger-line" />
          <span className="hamburger-line" />
        </button>
      </nav>

      <div
        id={menuId}
        className="mobile-menu-popover mobile-only"
        ref={mobileMenuRef}
        style={cssVars}
        aria-hidden={!isMobileMenuOpen}
      >
        <ul className="mobile-menu-list" role="menu">
          {items.map((item, index) => (
            <li key={item.href || `mobile-item-${index}`}>
              <a
                href={item.href || '#'}
                className={`mobile-menu-link${activeHref === item.href ? ' is-active' : ''}`}
                onClick={(event) => {
                  animateMobileMenu(false);
                  handleItemClick(item, event);
                }}
                role="menuitem"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
