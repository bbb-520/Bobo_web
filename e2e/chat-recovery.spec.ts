import { expect, test } from '@playwright/test';
import { mockBackend } from './mock-backend';

test('signed-in user sends text and receives a completed reply in the real App', async ({ page }) => {
  const backend = await mockBackend(page);
  await page.goto('/#chat');
  await expect(page.getByText('Smoke User', { exact: true }).first()).toBeVisible();
  await page.getByLabel('聊天模式', { exact: true }).selectOption('text');
  await page.getByRole('textbox', { name: '消息输入框' }).fill('你好，请回复一句话。');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('文字回复已完成：这是本地模拟结果。', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息输入框' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: '消息输入框' })).toHaveValue('');
  expect(backend.calls.filter(call => call.method === 'POST' && call.path === '/api/agent-executions')).toHaveLength(1);
  expect(backend.calls.some(call => call.method === 'POST' && call.path === '/api/image-jobs')).toBe(false);
  expect(backend.unexpected).toEqual([]);
});

for (const scenario of ['供应商拒绝了该请求', '图片结果未知，正在等待供应商对账'] as const) {
  test(`image failure recovers the wallet and text composer: ${scenario}`, async ({ page }) => {
    const backend = await mockBackend(page);
    await page.goto('/#chat');
    await expect(page.getByText('Smoke User', { exact: true }).first()).toBeVisible();
    await page.getByLabel('聊天模式', { exact: true }).selectOption('image');
    await page.getByRole('textbox', { name: '消息输入框' }).fill('生成一张海边日落的图片');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('正在生成一张图片', { exact: true })).toBeVisible();
    const walletNote = page.locator('.composer-billing-note');
    await expect(walletNote).toContainText('待对账', { timeout: 15_000 });
    backend.failImage(scenario);
    await expect(page.getByText(scenario, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('textbox', { name: '消息输入框' }).fill('失败后保留的输入');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    backend.releaseWallet();
    await expect(walletNote).not.toContainText('待对账', { timeout: 15_000 });
    await expect(page.getByRole('textbox', { name: '消息输入框' })).toHaveValue('失败后保留的输入');
    await page.getByLabel('聊天模式', { exact: true }).selectOption('text');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByText('文字回复已完成：这是本地模拟结果。', { exact: true })).toBeVisible();
    expect(backend.calls.filter(call => call.method === 'POST' && call.path === '/api/image-jobs')).toHaveLength(1);
    expect(backend.calls.filter(call => call.method === 'POST' && call.path === '/api/agent-executions')).toHaveLength(1);
    expect(backend.unexpected).toEqual([]);
  });
}
