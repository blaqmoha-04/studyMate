import nodemailer from 'nodemailer';

export function createMailer(config) {
  const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;
  return {
    configured: Boolean(transport),
    async send({ to, subject, text }) {
      if (!transport) throw new Error('SMTP is not configured');
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
    },
  };
}
