import type { Page, Route } from '@playwright/test';

const origin = 'http://127.0.0.1:4173';
export async function mockBackend(page: Page) {
  const calls: { method: string; path: string; body: any }[] = [];
  const unexpected: string[] = [];
  const snapshots = new Map<string, any>();
  const executions = new Map<string, any>();
  let job: any = null;
  let blocked = false;
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, json: body });

  // A fresh browser context starts with a mocked signed-in account; no credentials are used.
  await page.addInitScript(() => localStorage.setItem('bobo.onboarding.chat.v2.smoke-user', 'done'));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      unexpected.push(`External request blocked: ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname;
    const method = request.method();
    const body = request.postData() ? request.postDataJSON() : undefined;
    calls.push({ method, path, body });
    if (path === '/api/auth/me' && method === 'GET') return json(route, {
      userId: 'smoke-user', username: 'Smoke User', roles: ['USER'],
      permissions: ['chat:use', 'wallet:read', 'media:generate', 'model:manage'],
    });
    if (path === '/api/auth/csrf' && method === 'GET') return json(route, { headerName: 'X-XSRF-TOKEN', token: 'local-smoke-token' });
    if (path === '/api/billing/wallet' && method === 'GET') return json(route, {
      balanceMicros: 5_000_000, reservedMicros: blocked ? 1_000_000 : 0,
      freeImages: 0, freeTokens: 1_000_000, arrears: false, lowBalance: false,
      blocked, activeUsageId: blocked ? 'fixture-image-usage' : null,
    });
    if (path === '/api/billing/events' && method === 'GET') return route.fulfill({
      status: 200, contentType: 'text/event-stream', body: ': local fixture heartbeat\n\n',
    });
    if (path === '/api/settings/models' && method === 'GET') return json(route, []);
    if (path === '/api/conversations' && method === 'GET') return json(route, []);
    if (path.startsWith('/api/conversations/') && method === 'PUT') {
      const id = decodeURIComponent(path.split('/').at(-1)!);
      const view = { id, revision: (snapshots.get(id)?.revision ?? 0) + 1, deleted: body.deleted, snapshot: body.snapshot };
      snapshots.set(id, view); return json(route, view);
    }
    if (path.startsWith('/api/conversations/') && method === 'GET') return json(route, snapshots.get(path.split('/').at(-1)!) ?? {}, 200);
    if (path === '/api/agent-executions' && method === 'POST') {
      const view = { ...body, executionId: `fixture-execution-${executions.size + 1}`, status: 'COMPLETED',
        version: 1, lastSeq: 1, generationVersion: 1, answer: '文字回复已完成：这是本地模拟结果。', sources: [],
        error: null, roundsUsed: 1, roundLimit: 4, tokensUsed: 10, toolCalls: 0 };
      executions.set(view.executionId, view); return json(route, view, 202);
    }
    if (path.startsWith('/api/agent-executions/') && method === 'GET') {
      const id = path.split('/')[3];
      if (executions.has(id)) return json(route, executions.get(id));
    }
    if (path === '/api/image-jobs' && method === 'POST') {
      blocked = true;
      job = { ...body, jobId: 'fixture-image-job', status: 'PROCESSING', createdAt: new Date().toISOString() };
      return json(route, job, 202);
    }
    if (path === '/api/image-jobs' && method === 'GET') return json(route, job ? [job] : []);
    if (path.startsWith('/api/image-jobs/by-request/') && method === 'GET') return json(route, job ?? { message: 'not found' }, job ? 200 : 404);
    if (path === '/api/image-jobs/fixture-image-job' && method === 'GET') return json(route, job);
    // Never forward an unknown API (especially payment/model calls) to a live backend.
    unexpected.push(`${method} ${path}`);
    return json(route, { message: 'Unmocked API blocked by smoke fixture' }, 501);
  });
  return {
    calls, unexpected,
    failImage(error: string) { if (!job) throw new Error('No fixture image request'); job = { ...job, status: 'FAILED', error }; },
    releaseWallet() { blocked = false; },
  };
}
