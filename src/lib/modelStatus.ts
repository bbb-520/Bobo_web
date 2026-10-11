export interface ModelStatus {
  provider: string;
  model: string;
  capability: string;
  state: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  fallback: boolean;
  generationVersion?: number;
}

export function readModelStatus(value: unknown): ModelStatus | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.provider !== 'string' || !data.provider || typeof data.model !== 'string' || !data.model ||
      !['RUNNING', 'SUCCEEDED', 'FAILED'].includes(String(data.state))) return undefined;
  return { provider: data.provider, model: data.model, capability: typeof data.capability === 'string' ? data.capability : '',
    state: data.state as ModelStatus['state'], fallback: data.fallback === true };
}

export const providerLabel = (provider: string) => (({ GPT: 'ChatGPT', QWEN: '千问' } as Record<string,string>)[provider] ?? provider);
