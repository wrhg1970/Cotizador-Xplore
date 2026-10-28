'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { guidesFor } from './guia/content';
import type { Me } from './lib/types';

const SEEN_KEY = 'ee-welcome-seen';

/** First-visit tour: one step per role the person holds. */
// shortcut: "seen" lives in this browser only, per browser, so a new device shows the tour once more; move to the user record if that bothers people.
export function Welcome({ me }: { me: Me }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const guides = guidesFor(me.roles.map((r) => r.role));

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      // Storage blocked: skip the tour rather than show it on every page.
    }
    if (!seen) dialog.current?.showModal();
  }, []);

  function close() {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Nothing to persist; the tour simply may show again.
    }
    dialog.current?.close();
  }

  const g = guides[step] ?? guides[0]!;
  const last = step === guides.length - 1;
  return (
    <dialog ref={dialog} className="welcome" aria-labelledby="welcome-title" onCancel={close}>
      <p className="muted">
        Te damos la bienvenida, {me.name.split(/\s+/)[0]} · paso {step + 1} de {guides.length}
      </p>
      <h2 id="welcome-title">Como {g.title.toLowerCase()}</h2>
      <p>{g.summary}</p>
      <ol>
        {g.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <div className="row">
        {step > 0 && (
          <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
            Anterior
          </button>
        )}
        {last ? (
          <button type="button" onClick={close}>
            Empezar
          </button>
        ) : (
          <button type="button" onClick={() => setStep(step + 1)}>
            Siguiente
          </button>
        )}
        <Link href="/guia" onClick={close}>
          Ver la guía completa
        </Link>
      </div>
    </dialog>
  );
}
