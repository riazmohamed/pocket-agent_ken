/**
 * Heartbeat utilities — shared logic for detecting and stripping
 * the HEARTBEAT_OK silent-acknowledgment token.
 *
 * LLMs frequently wrap tokens in bold markdown (**HEARTBEAT_OK**),
 * HTML tags (<b>HEARTBEAT_OK</b>), or add trailing punctuation.
 * These helpers normalize before matching.
 */

/** The canonical heartbeat token. */
export const HEARTBEAT_OK = 'HEARTBEAT_OK';

/** Instruction suffix appended to recurring scheduled job prompts. */
export const HEARTBEAT_SUFFIX = '\n\nIf nothing needs attention, reply with only HEARTBEAT_OK.';

/**
 * Check whether a response contains the HEARTBEAT_OK token.
 *
 * Handles common LLM formatting quirks:
 *  - Bold markdown: **HEARTBEAT_OK**
 *  - Trailing punctuation: HEARTBEAT_OK. / HEARTBEAT_OK!
 *  - Case variations: heartbeat_ok, Heartbeat_Ok
 *  - HTML wrappers: <b>HEARTBEAT_OK</b>
 */
export function isHeartbeatOk(response: string): boolean {
  // Strip common markup wrappers and normalize
  const cleaned = response
    .replace(/<\/?[^>]+>/g, '') // strip HTML tags
    .replace(/\*{1,2}/g, ''); // strip markdown bold/italic
  return cleaned.toUpperCase().includes(HEARTBEAT_OK);
}

/**
 * Strip the heartbeat instruction suffix from a prompt before saving to memory.
 */
export function stripHeartbeatSuffix(prompt: string): string {
  if (prompt.endsWith(HEARTBEAT_SUFFIX)) {
    return prompt.slice(0, -HEARTBEAT_SUFFIX.length);
  }
  return prompt;
}
