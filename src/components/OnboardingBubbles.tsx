import { useEffect, useState } from 'react';
import { IconClose } from './icons';

const KEY_PREFIX = 'bobo.onboarding.chat.v2';

function storageKey(scope: string) {
  const safe = scope.trim().replace(/[^a-zA-Z0-9_.@-]/g, '_') || 'guest';
  return `${KEY_PREFIX}.${safe}`;
}

interface Props {
  scope: string;
  onOpenProfile: () => void;
}

export default function OnboardingBubbles({ scope, onOpenProfile }: Props) {
  const [step, setStep] = useState<1 | 2 | null>(() => {
    try { return localStorage.getItem(storageKey(scope)) === 'done' ? null : 1; } catch { return 1; }
  });

  useEffect(() => {
    if (step === null) return;
    try { localStorage.setItem(storageKey(scope), 'active'); } catch { /* private mode */ }
  }, [scope, step]);

  if (step === null) return null;

  const finish = () => {
    try { localStorage.setItem(storageKey(scope), 'done'); } catch { /* private mode */ }
    setStep(null);
  };

  return (
    <div className="onboarding-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) finish(); }}>
      <section className="onboarding-bubble" role="dialog" aria-modal="false" aria-labelledby="onboarding-title">
        <button type="button" className="onboarding-close" onClick={finish} aria-label="关闭引导"><IconClose size={15} /></button>
        <span className="profile-kicker">BOBO / {step} OF 2</span>
        <h3 id="onboarding-title">{step === 1 ? '把照片变成新的记忆' : '在用户页查看额度与充值'}</h3>
        <p>{step === 1 ? '新用户获得 100 万 Token 免费额度，所有模型调用共用，包括图片创作、文档索引与概要；剩余不超过 10 万 Token 时提醒。图片未返回实际 Token 时按图片价格折算免费额度。' : '打开右上角用户名进入用户页，查看免费 Token 额度、余额和消费记录，支持支付宝与微信充值。欠费后无法交互，充值到账后可继续。'}</p>
        <div className="onboarding-actions">
          {step === 2 && <button type="button" className="onboarding-link" onClick={() => { finish(); onOpenProfile(); }}>打开用户页</button>}
          <button type="button" className="setup-primary" onClick={() => step === 1 ? setStep(2) : finish()}>{step === 1 ? '下一步' : '知道了'}</button>
        </div>
      </section>
    </div>
  );
}
