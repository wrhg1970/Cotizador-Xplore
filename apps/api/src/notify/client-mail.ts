import type { Mail } from './notifier.js';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Comma/semicolon separated list of addresses; null if any is not an email. */
export function parseEmails(list: string): string[] | null {
  const all = list
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ok =
    all.length > 0 && all.length <= 10 && all.every((e) => /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(e));
  return ok ? all : null;
}

interface Letter {
  to: string[];
  subject: string;
  /** Paragraphs; plain text, escaped for the HTML part. */
  body: string[];
  button?: { label: string; url: string };
  origin: string;
}

/** Brand template (Xplore Together navy/orange), table layout so mail clients keep it. */
function letter({ to, subject, body, button, origin }: Letter): Mail {
  const text = [
    ...body,
    ...(button ? ['', `${button.label}: ${button.url}`] : []),
    '',
    'Estudiantes Embajadores · Xplore Together',
  ].join('\n');
  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#edf5fa;font-family:Arial,Helvetica,sans-serif;color:#10233f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:18px">
<tr><td style="background:#00457f;border-radius:18px 18px 0 0;padding:20px 28px"><img src="${esc(origin)}/icon.png" width="40" height="40" alt="" style="vertical-align:middle"> <span style="color:#ffffff;font-size:20px;font-weight:bold;vertical-align:middle">Xplore Together</span></td></tr>
<tr><td style="padding:28px">
${body.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join('\n')}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#c2410c;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px;display:inline-block">${esc(button.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #d8dee6;font-size:12px;color:#3d4e66">Estudiantes Embajadores · Xplore Together</td></tr>
</table></td></tr></table></body></html>`;
  return { to: to.join(', '), subject, text, html };
}

export function proposalMail(p: {
  to: string[];
  folio: string;
  groupName: string;
  url: string;
  origin: string;
  message?: string;
  sender: string;
}): Mail {
  return letter({
    to: p.to,
    subject: `Propuesta de viaje: ${p.groupName} (${p.folio})`,
    body: [
      'Hola:',
      p.message ??
        `Te compartimos la propuesta de viaje para ${p.groupName}. Puedes revisarla y aceptarla en línea.`,
      `Quedamos atentos a tus comentarios. ${p.sender}, Estudiantes Embajadores.`,
    ],
    button: { label: 'Ver la propuesta', url: p.url },
    origin: p.origin,
  });
}

export function paymentReminderMail(p: {
  to: string[];
  folio: string;
  groupName: string;
  number: number;
  dueDate: string;
  amount: string;
  currency: string;
  url: string | null;
  origin: string;
}): Mail {
  return letter({
    to: p.to,
    subject: `Recordatorio de pago ${p.number}: ${p.groupName} (${p.folio})`,
    body: [
      'Hola:',
      `Te recordamos que el pago ${p.number} del viaje ${p.groupName} vence el ${p.dueDate}: ${p.amount} ${p.currency} por estudiante.`,
      'Si ya realizaste el pago, ignora este mensaje. Gracias.',
    ],
    ...(p.url && { button: { label: 'Pagar en línea', url: p.url } }),
    origin: p.origin,
  });
}
