/**
 * Agent mode switching tool — allows the agent to switch its operating mode mid-conversation.
 *
 * Registered as an MCP tool in all modes. When called, it updates the session's mode
 * in the database and signals the UI to update.
 */

import { ALL_MODE_IDS, AGENT_MODES, isValidModeId } from '../agent/agent-modes';
import type { AgentModeId, OnHandoffCallback } from '../agent/agent-modes';

// Callback set by AgentManager to handle the actual mode switch
let switchModeCallback:
  | ((sessionId: string, newMode: AgentModeId, reason: string) => Promise<string>)
  | null = null;

// Callback to get the current session ID from the tool execution context
let getSessionIdCallback: (() => string | null) | null = null;

// Callback to get the current mode for a session (for directed graph validation)
let getCurrentModeCallback: ((sessionId: string) => AgentModeId | null) | null = null;

// Registered on_handoff callbacks
const onHandoffCallbacks: OnHandoffCallback[] = [];

export function setSwitchModeCallback(
  cb: (sessionId: string, newMode: AgentModeId, reason: string) => Promise<string>
): void {
  switchModeCallback = cb;
}

export function setGetSessionIdCallback(cb: () => string | null): void {
  getSessionIdCallback = cb;
}

export function setGetCurrentModeCallback(cb: (sessionId: string) => AgentModeId | null): void {
  getCurrentModeCallback = cb;
}

export function addOnHandoffCallback(cb: OnHandoffCallback): void {
  onHandoffCallbacks.push(cb);
}

export function getOnHandoffCallbacks(): OnHandoffCallback[] {
  return onHandoffCallbacks;
}

export interface AgentModeTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export function getSwitchAgentTool(): AgentModeTool {
  return {
    name: 'switch_agent',
    description: 'Hand off to a different agent mode. Conversation context is preserved.',
    input_schema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ALL_MODE_IDS,
          description: 'The agent mode to switch to',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for switching (shown to user)',
        },
      },
      required: ['mode', 'reason'],
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const mode = input.mode as string;
      const reason = (input.reason as string) || 'Mode switch requested';

      if (!isValidModeId(mode)) {
        return `Error: Invalid mode "${mode}". Valid modes: ${ALL_MODE_IDS.join(', ')}`;
      }

      const sessionId = getSessionIdCallback?.();
      if (!sessionId) {
        return 'Error: No active session context for mode switch';
      }

      // Validate directed handoff graph
      const currentMode = getCurrentModeCallback?.(sessionId);
      if (currentMode) {
        const currentConfig = AGENT_MODES[currentMode];
        if (!currentConfig.canHandoffTo.includes(mode as AgentModeId)) {
          return `Cannot switch directly from ${currentMode} to ${mode}. Available targets from ${currentMode}: ${currentConfig.canHandoffTo.join(', ')}`;
        }
      }

      if (!switchModeCallback) {
        return 'Error: Mode switching not initialized';
      }

      try {
        const result = await switchModeCallback(sessionId, mode as AgentModeId, reason);

        // Fire on_handoff callbacks
        const fromMode = currentMode || 'general';
        const context = {
          sessionId,
          fromMode: fromMode as AgentModeId,
          toMode: mode as AgentModeId,
          reason,
          timestamp: new Date(),
        };
        for (const cb of onHandoffCallbacks) {
          try {
            await cb(context);
          } catch (err) {
            console.error('[AgentModeTool] on_handoff callback error:', err);
          }
        }

        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return `Error switching mode: ${msg}`;
      }
    },
  };
}
