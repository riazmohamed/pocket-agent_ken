/**
 * Agent Home channel — connects to Agent Home relay for remote access
 * via the @kenkaiiii/agent-home-sdk package.
 */

import {
  AgentHomeClient,
  type AgentSession,
  type IncomingMessage,
  type ResponseStream,
} from '@kenkaiiii/agent-home-sdk';
import { BaseChannel } from '../index';
import { SettingsManager } from '../../settings';

const DEFAULT_RELAY_URL = 'wss://agent-home-relay.buzzbeamaustralia.workers.dev/ws';
const DEFAULT_AGENT_NAME = 'Pocket Agent';

export type AgentHomeMessageHandler = (
  message: IncomingMessage,
  stream: ResponseStream
) => void | Promise<void>;

export class AgentHomeChannel extends BaseChannel {
  name = 'agent-home';
  private client: AgentHomeClient | null = null;
  private connected = false;
  private messageHandler: AgentHomeMessageHandler | null = null;
  private connectHandler: (() => void) | null = null;

  setMessageHandler(handler: AgentHomeMessageHandler): void {
    this.messageHandler = handler;
  }

  onConnect(handler: () => void): void {
    this.connectHandler = handler;
  }

  updateSessions(sessions: AgentSession[]): void {
    if (this.client) {
      this.client.updateSessions(sessions);
      console.log(`[AgentHome] Pushed ${sessions.length} sessions to relay`);
    }
  }

  getStatus(): { connected: boolean; agentName: string } {
    return {
      connected: this.connected,
      agentName: SettingsManager.get('agentHome.agentName') || DEFAULT_AGENT_NAME,
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    const relayUrl = SettingsManager.get('agentHome.relayUrl') || DEFAULT_RELAY_URL;
    const token = SettingsManager.get('agentHome.token') || '';
    const agentName = SettingsManager.get('agentHome.agentName') || DEFAULT_AGENT_NAME;

    if (!token) {
      console.warn('[AgentHome] No token configured, cannot connect');
      throw new Error('Agent Home token is required');
    }

    this.client = new AgentHomeClient({
      relayUrl,
      token,
      agent: {
        id: 'pocket-agent',
        name: agentName,
        description: 'Pocket Agent desktop assistant',
        capabilities: ['chat', 'streaming'],
      },
    });

    this.client.onConnect(() => {
      this.connected = true;
      console.log('[AgentHome] Connected to relay');
      if (this.connectHandler) this.connectHandler();
    });

    this.client.onDisconnect(() => {
      this.connected = false;
      console.log('[AgentHome] Disconnected from relay');
    });

    this.client.onMessage((message: IncomingMessage, stream: ResponseStream) => {
      if (this.messageHandler) {
        this.messageHandler(message, stream);
      } else {
        stream.error('No message handler configured');
      }
    });

    try {
      this.client.connect();
      this.isRunning = true;
      console.log(`[AgentHome] Channel started (relay: ${relayUrl})`);
    } catch (error) {
      console.error('[AgentHome] Failed to start:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.connected = false;
    this.isRunning = false;
    console.log('[AgentHome] Channel stopped');
  }
}

// Singleton
let agentHomeInstance: AgentHomeChannel | null = null;

export function createAgentHomeChannel(): AgentHomeChannel | null {
  if (!agentHomeInstance) {
    try {
      agentHomeInstance = new AgentHomeChannel();
    } catch (error) {
      console.error('[AgentHome] Failed to create channel:', error);
      return null;
    }
  }
  return agentHomeInstance;
}

export function destroyAgentHomeChannel(): void {
  agentHomeInstance = null;
}
