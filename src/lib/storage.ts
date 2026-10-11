import type { Conversation, Settings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const CONV_KEY = 'travel-agent.conversations.v1';
const SETTINGS_KEY = 'bobo.settings.v2';
/** 最近选中的会话 id，刷新后自动恢复。 */
const ACTIVE_SESSION_KEY = 'travel-agent.activeSessionId.v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function scopedKey(key: string, scope = 'guest'): string {
  const safe = encodeURIComponent(scope.trim()) || 'guest';
  return `${key}.${safe}`;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return fallbackUuid();
}

export function loadConversations(scope = 'guest'): Conversation[] {
  try {
    const raw = localStorage.getItem(scopedKey(CONV_KEY, scope));
    if (!raw) return [];
    const arr = JSON.parse(raw) as Conversation[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((c) => c && typeof c.id === 'string')
      .map((c) => ({
        ...c,
        // 旧版本在非安全 HTTP 环境下可能生成 id-时间戳-随机串；迁移后再发送时必须使用 UUID。
        id: UUID_PATTERN.test(c.id) ? c.id : uid(),
        messages: Array.isArray(c.messages) ? c.messages.map(message =>
          message.status === 'streaming' && !message.execution
            ? { ...message, status: 'stopped' as const, endReason: 'aborted' as const, finishedAt: Date.now() }
            : message) : [],
      }));
  } catch {
    return [];
  }
}

export function saveConversations(list: Conversation[], scope = 'guest'): void {
  try {
    // OSS 结果地址是短期签名 URL：不把它持久化，刷新时由后端重新签发，
    // 避免把过期地址留在 localStorage，也避免把可访问链接长期留在本地。
    const snapshot = list.map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => ({
        ...message,
        attachments: message.attachments?.map(({ previewUrl: _previewUrl, ...attachment }) => attachment),
        imageJobs: message.imageJobs?.map(({ imageUrl: _imageUrl, ...job }) => job),
        zineResult: undefined, // Keep only the receipt ID; restore short-lived provider URLs from the owner API.
      })),
    }));
    localStorage.setItem(scopedKey(CONV_KEY, scope), JSON.stringify(snapshot));
  } catch {
    /* 存储满/隐私模式时忽略 */
  }
}

export function saveActiveSessionId(id: string | null, scope = 'guest'): void {
  try {
    const key = scopedKey(ACTIVE_SESSION_KEY, scope);
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function loadActiveSessionId(scope = 'guest'): string | null {
  try {
    return localStorage.getItem(scopedKey(ACTIVE_SESSION_KEY, scope));
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      // 后端地址仍保持同源默认值；应用已移除演示模式和连接模式切换。
      baseUrl: DEFAULT_SETTINGS.baseUrl,
      theme: s.theme === 'dark' ? 'dark' : DEFAULT_SETTINGS.theme,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/** 从文本取会话标题：取第一行、去 markdown、截断 */
export function deriveTitle(text: string, max = 18): string {
  const clean = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*`_~[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '新对话';
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}
