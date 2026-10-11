import type { ModelStatus } from '../lib/modelStatus';
import { providerLabel } from '../lib/modelStatus';
import './model-status.css';

export default function ModelStatusBadge({ status, taskStatus }: { status?: ModelStatus; taskStatus?: string }) {
  if (!status) return null;
  let state: string = status.state;
  if (taskStatus === 'STOPPED' || taskStatus === 'stopped') state = 'STOPPED';
  else if (taskStatus === 'FAILED' || taskStatus === 'error') state = 'FAILED';
  else if (taskStatus?.startsWith('WAITING_') || taskStatus === 'NEEDS_INPUT') state = 'WAITING';
  else if (state === 'RUNNING' && (taskStatus === 'COMPLETED' || taskStatus === 'done')) state = 'SUCCEEDED';
  const label = ({ RUNNING: '处理中', SUCCEEDED: '已完成', FAILED: '调用失败', STOPPED: '已停止', WAITING: '等待处理' } as Record<string,string>)[state];
  return <div className={`model-status-badge model-status-${state.toLowerCase()} provider-${status.provider.toLowerCase()}`} role="status" aria-live="polite">
    <span className="model-status-dot" aria-hidden="true" />
    <strong>{providerLabel(status.provider)}</strong>
    {status.fallback && <span className="model-fallback-label">兜底</span>}
    <span className="model-status-name">{status.model}</span>
    <span>{label}</span>
  </div>;
}
