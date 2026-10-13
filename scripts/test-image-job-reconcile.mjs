import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileImageJobs } from '../src/lib/imageJobPolling.ts';

const conversation = {
  id: 'conversation-1',
  messages: [
    { id: 'assistant-1', role: 'assistant', imageJobs: [{ jobId: 'old-job', status: 'QUEUED' }] },
    { id: 'assistant-2', role: 'assistant', imageJobs: [{ jobId: 'current-job', status: 'PROCESSING' }] },
  ],
};

test('authoritative empty response removes stale local jobs from every message', () => {
  const updated = reconcileImageJobs(conversation, []);
  assert.deepEqual(updated.messages.map((message) => message.imageJobs), [[], []]);
});

test('refreshes existing job in place and adds new jobs to latest assistant message', () => {
  const updated = reconcileImageJobs(conversation, [
    { jobId: 'old-job', status: 'SUCCEEDED', imageUrl: 'https://example.test/output.png' },
    { jobId: 'new-job', status: 'QUEUED' },
  ]);
  assert.deepEqual(updated.messages[0].imageJobs, [
    { jobId: 'old-job', status: 'SUCCEEDED', imageUrl: 'https://example.test/output.png' },
  ]);
  assert.deepEqual(updated.messages[1].imageJobs, [
    { jobId: 'new-job', status: 'QUEUED' },
  ]);
});
