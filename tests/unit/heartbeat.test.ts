import { describe, it, expect } from 'vitest';
import {
  HEARTBEAT_OK,
  HEARTBEAT_SUFFIX,
  isHeartbeatOk,
  stripHeartbeatSuffix,
} from '../../src/utils/heartbeat';

describe('isHeartbeatOk', () => {
  it('detects plain HEARTBEAT_OK', () => {
    expect(isHeartbeatOk('HEARTBEAT_OK')).toBe(true);
  });

  it('detects lowercase variant', () => {
    expect(isHeartbeatOk('heartbeat_ok')).toBe(true);
  });

  it('detects mixed case', () => {
    expect(isHeartbeatOk('Heartbeat_Ok')).toBe(true);
  });

  it('detects bold markdown wrapping', () => {
    expect(isHeartbeatOk('**HEARTBEAT_OK**')).toBe(true);
  });

  it('detects italic markdown wrapping', () => {
    expect(isHeartbeatOk('*HEARTBEAT_OK*')).toBe(true);
  });

  it('detects bold + trailing punctuation', () => {
    expect(isHeartbeatOk('**HEARTBEAT_OK**.')).toBe(true);
    expect(isHeartbeatOk('**HEARTBEAT_OK**!')).toBe(true);
  });

  it('detects HTML bold wrapping', () => {
    expect(isHeartbeatOk('<b>HEARTBEAT_OK</b>')).toBe(true);
  });

  it('detects HTML strong wrapping', () => {
    expect(isHeartbeatOk('<strong>HEARTBEAT_OK</strong>')).toBe(true);
  });

  it('detects token with surrounding whitespace', () => {
    expect(isHeartbeatOk('  HEARTBEAT_OK  ')).toBe(true);
  });

  it('detects token embedded in longer response', () => {
    expect(isHeartbeatOk('All systems normal. HEARTBEAT_OK')).toBe(true);
  });

  it('detects STATUS format from structured responses', () => {
    expect(isHeartbeatOk('STATUS: HEARTBEAT_OK\nREASON: All good.')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isHeartbeatOk('')).toBe(false);
  });

  it('rejects unrelated text', () => {
    expect(isHeartbeatOk('Everything is fine, no issues detected.')).toBe(false);
  });

  it('rejects partial match', () => {
    expect(isHeartbeatOk('HEARTBEAT')).toBe(false);
    expect(isHeartbeatOk('HEARTBEAT_')).toBe(false);
  });
});

describe('stripHeartbeatSuffix', () => {
  it('strips the suffix when present', () => {
    const prompt = 'Check the weather' + HEARTBEAT_SUFFIX;
    expect(stripHeartbeatSuffix(prompt)).toBe('Check the weather');
  });

  it('returns prompt unchanged when no suffix', () => {
    const prompt = 'Check the weather';
    expect(stripHeartbeatSuffix(prompt)).toBe('Check the weather');
  });

  it('only strips from the end, not the middle', () => {
    const prompt =
      HEARTBEAT_SUFFIX + ' and then do something';
    expect(stripHeartbeatSuffix(prompt)).toBe(prompt);
  });
});

describe('constants', () => {
  it('HEARTBEAT_OK is the expected token', () => {
    expect(HEARTBEAT_OK).toBe('HEARTBEAT_OK');
  });

  it('HEARTBEAT_SUFFIX contains the token', () => {
    expect(HEARTBEAT_SUFFIX).toContain('HEARTBEAT_OK');
  });
});
