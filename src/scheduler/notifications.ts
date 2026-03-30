import type { TelegramBot } from '../channels/telegram';
import type { MemoryManager } from '../memory';

/**
 * Notification handler types used by the scheduler.
 */
export type NotificationHandler = (title: string, body: string) => void;
export type ChatHandler = (
  jobName: string,
  prompt: string,
  response: string,
  sessionId: string
) => void;
export type IOSSyncHandler = (
  jobName: string,
  prompt: string,
  response: string,
  sessionId: string
) => void;

/**
 * Holds references to all notification channel handlers.
 */
export interface NotificationChannels {
  onNotification?: NotificationHandler;
  onChatMessage?: ChatHandler;
  onIOSSync?: IOSSyncHandler;
  telegramBot: TelegramBot | null;
  memory: MemoryManager | null;
}

/**
 * Strip markdown formatting for plain text (notifications).
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '[code]')
      .replace(/`([^`]+)`/g, '$1')
      // Remove links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove bullet points
      .replace(/^[\s]*[-*+]\s+/gm, '• ')
      // Remove extra whitespace
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Send a notification to all configured channels (desktop, iOS, Telegram).
 * Used by routeJobResponse for scheduled job results.
 */
export async function sendToAllChannels(
  channels: NotificationChannels,
  jobName: string,
  prompt: string,
  response: string,
  sessionId: string,
  recipient?: string
): Promise<void> {
  // Always send to desktop chat window
  if (channels.onChatMessage) {
    channels.onChatMessage(jobName, prompt, response, sessionId);
  }
  // Note: no system notification here — the agent sends notifications via the notify
  // tool when appropriate, so a duplicate system notification is unnecessary.

  // Send to iOS devices
  if (channels.onIOSSync) {
    channels.onIOSSync(jobName, prompt, response, sessionId);
  }

  // Also send to Telegram if configured and session has a linked chat
  if (channels.telegramBot && channels.memory) {
    if (recipient) {
      // Send to specific chat (explicitly specified)
      const chatId = parseInt(recipient, 10);
      if (!isNaN(chatId)) {
        await channels.telegramBot.sendMessage(chatId, `📅 ${jobName}\n\n${response}`);
      }
    } else {
      // Send to session's linked chat if it exists
      const linkedChatId = channels.memory.getChatForSession(sessionId);
      if (linkedChatId) {
        await channels.telegramBot.sendMessage(linkedChatId, `📅 ${jobName}\n\n${response}`);
      }
    }
  }
}

/**
 * Send a reminder notification to all configured channels.
 * Used for calendar events and task reminders.
 */
export async function sendReminderToAllChannels(
  channels: NotificationChannels,
  type: 'calendar' | 'task',
  message: string,
  sessionId: string
): Promise<void> {
  // Always send to desktop (notification + chat to the correct session)
  if (channels.onNotification) {
    channels.onNotification('Pocket Agent', message);
  }
  if (channels.onChatMessage) {
    channels.onChatMessage(`${type}_reminder`, message, message, sessionId);
  }

  // Send to iOS devices
  if (channels.onIOSSync) {
    channels.onIOSSync(`${type}_reminder`, message, message, sessionId);
  }

  // Also send to Telegram if configured AND session has a linked chat
  if (channels.telegramBot && channels.memory) {
    const linkedChatId = channels.memory.getChatForSession(sessionId);
    if (linkedChatId) {
      await channels.telegramBot.sendMessage(
        linkedChatId,
        `${type === 'calendar' ? '📅' : '✓'} ${message}`
      );
    }
  }
}
