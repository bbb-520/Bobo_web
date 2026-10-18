import { useEffect, useRef, useState } from 'react';
import landingWallpaper from '../assets/landing-wallpaper.jpg';
import ParticleText from './ParticleText';
import ScrambledText from './ScrambledText';
import DodgeField from './DodgeField';
import PillNav from './PillNav';
import boboMark from '../assets/bobo-mark.svg';

interface Props {
  onStart: () => void;
  onOpenAbout: () => void;
  onOpenWorld: () => void;
  onOpenPrompts?: () => void;
  active?: boolean;
}

const SUBTITLES = [
  '正 在 和 世 界 解 耦 合',
  '好奇怪 这些照片怎么自带评论',
  'P L O G',
  '拍下照片我会幸福两次 一次是按下快门的瞬间 一次是翻看相册的时候',
  '接受一切事与愿违',
  'Moments of happiness stick with us',
];

/**
 * 入口页参考 summerWeb-temp：暖色编辑感画布、固定导航、壁纸叠层、
 * 居中 Hero 和轻量的副标题轮播。进入聊天仍使用原有 hash 路由。
 */
export default function StartPage({ onStart, onOpenAbout, onOpenWorld, onOpenPrompts, active = true }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const [typedSubtitle, setTypedSubtitle] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const timer = useRef<number | null>(null);

  const go = () => {
    if (leaving) return;
    setLeaving(true);
    timer.current = window.setTimeout(onStart, 420);
  };

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    const target = SUBTITLES[subtitleIndex];
    const finishedTyping = typedSubtitle === target && !isDeleting;
    const finishedDeleting = typedSubtitle.length === 0 && isDeleting;
    const delay = finishedTyping ? 1700 : finishedDeleting ? 420 : isDeleting ? 42 : 78;
    const timeout = window.setTimeout(() => {
      if (finishedTyping) {
        setIsDeleting(true);
      } else if (finishedDeleting) {
        setIsDeleting(false);
        setSubtitleIndex((index) => (index + 1) % SUBTITLES.length);
      } else if (isDeleting) {
        setTypedSubtitle((value) => value.slice(0, -1));
      } else {
        setTypedSubtitle(target.slice(0, typedSubtitle.length + 1));
      }
    }, delay);
    return () => window.clearTimeout(timeout);
  }, [isDeleting, subtitleIndex, typedSubtitle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!active || (event.target instanceof Element && event.target.closest('button,a,input,textarea,select'))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`start reference-landing${leaving ? ' leaving' : ''}`} onClick={go}>
      <div className="start-wallpaper" aria-hidden="true">
        <img src={landingWallpaper} alt="" />
        <div className="start-wallpaper-wash" />
        <div className="start-wallpaper-grain" />
      </div>

      <header className="start-nav">
        <button className="start-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="start-brand-mark">
            <img src={boboMark} alt="" />
          </span>
          <span className="start-brand-name">bobo</span>
        </button>

        <PillNav
          className="start-pill-nav"
          logo={boboMark}
          logoAlt="bobo"
          items={[
            { label: 'Bobo’s World', href: '#world', onClick: onOpenWorld },
            { label: '提示词', href: '#prompts', onClick: onOpenPrompts },
            { label: '关于bbb', href: '#about', onClick: onOpenAbout },
          ]}
          activeHref="#home"
          ease="power2.out"
          baseColor="#17171a"
          pillColor="#fbfbfc"
          hoveredPillTextColor="#ffffff"
          pillTextColor="#17171a"
        />

      </header>

      <main className="start-main">
        <ParticleText text="bobo" highlightColor="#77777e" />
        <p className="start-desc start-typed" aria-live="polite">
          {typedSubtitle}<span className="start-cursor" aria-hidden="true">▊</span>
        </p>
        <div className="start-cta-field" onClick={(event) => event.stopPropagation()}>
          <DodgeField
            className="start-dodge"
            inkColor="#17171a"
            contrastColor="#ffffff"
            taunts={['Catch me', 'Nope', 'Almost', 'Too slow', 'Okay, okay']}
            patience={6}
            fieldHeight={174}
            reach={92}
            radius={174}
            falloff={1.25}
            wall="bounce"
            onCatch={go}
          />
        </div>
        <div className="start-enter-hint">
          <ScrambledText radius={130} duration={1.1} speed={0.55} scrambleChars=".:/\\" className="start-enter-scramble">
            点击鼠标或按任意键进入
          </ScrambledText>
        </div>
      </main>
    </div>
  );
}
