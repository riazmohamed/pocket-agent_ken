/**
 * Session-name sanitizer — single source of truth used by IPC, Telegram
 * commands, and (via inlined copy in ui/chat/sessions.js) the renderer.
 *
 * Rules:
 *  1. Strip filesystem-illegal characters (`/`, `\`, `:`, `*`, `?`, `"`,
 *     `<`, `>`, `|`, NULs and other control chars) — the name doubles
 *     as a directory under the workspace.
 *  2. Strip leading dots so we don't create hidden folders.
 *  3. Collapse runs of whitespace to a single space, then trim.
 *  4. Cap length to SESSION_NAME_MAX.
 *  5. Reject Windows reserved device names (CON, PRN, AUX, NUL, COM1..9,
 *     LPT1..9) — irrelevant on macOS but cheap insurance for portability.
 *  6. If the result is empty after sanitizing, fall back to 'Untitled'.
 */

export const SESSION_NAME_MAX = 40;

// eslint-disable-next-line no-control-regex -- intentional: strip C0 controls
const FS_ILLEGAL = /[<>:"/\\|?*\u0000-\u001F]/g;
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitizeSessionName(raw: string): string {
  if (typeof raw !== 'string') return 'Untitled';

  // Order matters: collapse whitespace FIRST so tabs/newlines (which are
  // C0 controls and would otherwise be stripped by FS_ILLEGAL) are
  // preserved as word boundaries instead of glued together.
  let name = raw
    .replace(/\s+/g, ' ')
    .replace(FS_ILLEGAL, '')
    .trim()
    .replace(/^\.+/, '') // no leading dots (hidden file on *nix)
    .replace(/\.+$/, '') // no trailing dots (Windows quirk)
    .slice(0, SESSION_NAME_MAX)
    .trim();

  if (!name) return 'Untitled';
  if (WIN_RESERVED.test(name)) name = `${name}_`;
  return name;
}
