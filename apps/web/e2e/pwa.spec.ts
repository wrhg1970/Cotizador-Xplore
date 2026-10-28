import { expect, test } from '@playwright/test';
import { newItems } from '../app/WorkNotifier';

test('the app is installable: manifest opens on Mi trabajo, icons and service worker are served', async ({
  request,
}) => {
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ start_url: '/inicio', display: 'standalone' });
  for (const icon of manifest.icons as { src: string }[])
    expect((await request.get(icon.src)).headers()['content-type']).toBe('image/png');
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).not.toContain("addEventListener('fetch'");
});

test('notices only items that are new since the last check', () => {
  const t = (requestId: string) => ({ kind: 'QUOTE', requestId, folio: 'F', groupName: 'G', quoteId: null });
  const data = { tasks: [t('a'), t('b')], alerts: [] };
  const first = newItems(data, null);
  expect(first.fresh).toEqual([]);
  expect(newItems({ ...data, tasks: [...data.tasks, t('c')] }, new Set(first.keys)).fresh).toEqual([t('c')]);
});
