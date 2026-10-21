import 'server-only';

import nodemailer from 'nodemailer';

export type SmtpEmailAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export async function sendSmtpEmail({
  to,
  subject,
  html,
  attachments,
}: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: SmtpEmailAttachment[];
}) {
  const host = process.env.REPORTS_SMTP_HOST ?? 'smtp.gmail.com';
  const port = Number(process.env.REPORTS_SMTP_PORT ?? 465);
  const user = process.env.REPORTS_SMTP_USER;
  const password = process.env.REPORTS_SMTP_PASS;
  const from = process.env.REPORTS_EMAIL_FROM;
  if (!from) throw new Error('Falta configurar REPORTS_EMAIL_FROM para enviar correos.');
  if (Boolean(user) !== Boolean(password)) {
    throw new Error(
      'Configura REPORTS_SMTP_USER y REPORTS_SMTP_PASS juntos, o deja ambos vacíos para usar SMTP Relay por IP.'
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('REPORTS_SMTP_PORT no es válido.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.REPORTS_SMTP_SECURE
      ? process.env.REPORTS_SMTP_SECURE === 'true'
      : port === 465,
    ...(user && password ? { auth: { user, pass: password } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const result = await transporter.sendMail({
    from,
    to,
    subject,
    html,
    attachments,
  });
  return result.messageId ?? null;
}
