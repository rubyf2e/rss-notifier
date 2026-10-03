export const MAIL_QUEUE = 'mail';
export const SEND_MAGIC_LINK_EMAIL_JOB = 'send-magic-link-email';
export const SEND_ARTICLE_NOTIFICATION_EMAIL_JOB = 'send-article-notification-email';
export const MAX_NOTIFICATION_ATTEMPTS = 5;

export interface SendMagicLinkEmailJobData {
  recipientEmail: string;
  loginUrl: string;
}

export interface SendArticleNotificationEmailJobData {
  notificationLogId: string;
}

export type MailJobData =
  | SendMagicLinkEmailJobData
  | SendArticleNotificationEmailJobData;