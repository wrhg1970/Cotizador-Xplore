'use client';

import { useEffect, useState } from 'react';
import { api } from './lib/api';

interface Item {
  kind: string;
  requestId: string;
  folio: string;
  groupName: string;
  quoteId: string | null;
}
interface Dashboard {
  tasks: Item[];
  alerts: (Item & { detail: string })[];
}

const SEEN_KEY = 'ee.notified';
const EVERY_MS = 5 * 60_000;
const key = (i: Item) => `${i.kind}:${i.requestId}:${i.quoteId ?? ''}`;
const supported = () =>
  typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;

function readSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function writeSeen(keys: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
  } catch {
    // Private mode: we may repeat a notice, nothing breaks.
  }
}

/** Only the new items since the last check; the first check just records what is there. */
export function newItems(data: Dashboard, seen: Set<string> | null) {
  const all = [...data.tasks, ...data.alerts];
  return { fresh: seen ? all.filter((i) => !seen.has(key(i))) : [], keys: all.map(key) };
}

/**
 * Device notifications for new tasks and overdue alerts.
 * shortcut: checks every 5 minutes only while the app (or a tab) is open; e-mail covers the closed case.
 * Upgrade to Web Push (VAPID keys + stored subscriptions) if people need notices with the app closed.
 */
export function WorkNotifier() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setPermission(supported() ? Notification.permission : 'unsupported');
    if (supported()) void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;
    const check = async () => {
      const data = await api<Dashboard>('/dashboard').catch(() => null);
      if (!data) return;
      const { fresh, keys } = newItems(data, readSeen());
      writeSeen(keys);
      const reg = await navigator.serviceWorker.ready;
      for (const i of fresh.slice(0, 5))
        await reg.showNotification(`${i.folio} · ${i.groupName}`, {
          body: 'detail' in i ? String(i.detail) : 'Tienes un pendiente nuevo',
          tag: key(i),
          icon: '/pwa/icon-192.png',
          data: { url: i.quoteId ? `/cotizaciones/${i.quoteId}` : `/solicitudes/${i.requestId}` },
        });
    };
    void check();
    const t = setInterval(() => void check(), EVERY_MS);
    return () => clearInterval(t);
  }, [permission]);

  if (permission !== 'default') return null;
  return (
    <button
      className="secondary"
      onClick={() => void Notification.requestPermission().then(setPermission)}
      title="Avisos en este dispositivo de tareas nuevas y atrasos"
    >
      Activar avisos
    </button>
  );
}
