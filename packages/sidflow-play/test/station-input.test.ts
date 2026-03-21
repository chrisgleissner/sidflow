/**
 * Tests for packages/sidflow-play/src/station/input.ts
 *
 * Covers the pure input-mapping helpers:
 *   mapSeedToken, mapStationToken, decodeTerminalInput
 */

import { describe, expect, it } from 'bun:test';
import { mapSeedToken, mapStationToken, decodeTerminalInput } from '../src/station/input.js';

// ─── mapSeedToken ─────────────────────────────────────────────────────────────

describe('mapSeedToken', () => {
  it('q → quit', () => {
    expect(mapSeedToken('q')).toEqual({ type: 'quit' });
  });

  it('ctrl-c → quit', () => {
    expect(mapSeedToken('\u0003')).toEqual({ type: 'quit' });
  });

  it('b → back', () => {
    expect(mapSeedToken('b')).toEqual({ type: 'back' });
  });

  it('left → back', () => {
    expect(mapSeedToken('left')).toEqual({ type: 'back' });
  });

  it('r → replay', () => {
    expect(mapSeedToken('r')).toEqual({ type: 'replay' });
  });

  it('up → replay', () => {
    expect(mapSeedToken('up')).toEqual({ type: 'replay' });
  });

  it('l → like (rating 5)', () => {
    expect(mapSeedToken('l')).toEqual({ type: 'rate', rating: 5 });
  });

  it('+ → like (rating 5)', () => {
    expect(mapSeedToken('+')).toEqual({ type: 'rate', rating: 5 });
  });

  it('d → dislike (rating 0)', () => {
    expect(mapSeedToken('d')).toEqual({ type: 'rate', rating: 0 });
  });

  it('x → dislike (rating 0)', () => {
    expect(mapSeedToken('x')).toEqual({ type: 'rate', rating: 0 });
  });

  it('s → skip', () => {
    expect(mapSeedToken('s')).toEqual({ type: 'skip' });
  });

  it('right → skip', () => {
    expect(mapSeedToken('right')).toEqual({ type: 'skip' });
  });

  it('down → skip', () => {
    expect(mapSeedToken('down')).toEqual({ type: 'skip' });
  });

  it('"" (enter) → skip', () => {
    expect(mapSeedToken('')).toEqual({ type: 'skip' });
  });

  it('numeric "3" → rate 3', () => {
    expect(mapSeedToken('3')).toEqual({ type: 'rate', rating: 3 });
  });

  it('numeric "0" → rate 0', () => {
    expect(mapSeedToken('0')).toEqual({ type: 'rate', rating: 0 });
  });

  it('numeric "5" → rate 5', () => {
    expect(mapSeedToken('5')).toEqual({ type: 'rate', rating: 5 });
  });

  it('numeric "6" beyond range → null', () => {
    expect(mapSeedToken('6')).toBeNull();
  });

  it('unknown token → null', () => {
    expect(mapSeedToken('z')).toBeNull();
  });

  it('multi-char unknown → null', () => {
    expect(mapSeedToken('hello')).toBeNull();
  });
});

// ─── mapStationToken ──────────────────────────────────────────────────────────

describe('mapStationToken', () => {
  it('q → quit', () => {
    expect(mapStationToken('q')).toEqual({ type: 'quit' });
  });

  it('ctrl-c → quit', () => {
    expect(mapStationToken('\u0003')).toEqual({ type: 'quit' });
  });

  it('right → next', () => {
    expect(mapStationToken('right')).toEqual({ type: 'next' });
  });

  it('n → next', () => {
    expect(mapStationToken('n')).toEqual({ type: 'next' });
  });

  it('left → back', () => {
    expect(mapStationToken('left')).toEqual({ type: 'back' });
  });

  it('b → back', () => {
    expect(mapStationToken('b')).toEqual({ type: 'back' });
  });

  it('up → cursorUp', () => {
    expect(mapStationToken('up')).toEqual({ type: 'cursorUp' });
  });

  it('k → cursorUp', () => {
    expect(mapStationToken('k')).toEqual({ type: 'cursorUp' });
  });

  it('down → cursorDown', () => {
    expect(mapStationToken('down')).toEqual({ type: 'cursorDown' });
  });

  it('j → cursorDown', () => {
    expect(mapStationToken('j')).toEqual({ type: 'cursorDown' });
  });

  it('pgup → pageUp', () => {
    expect(mapStationToken('pgup')).toEqual({ type: 'pageUp' });
  });

  it('pgdn → pageDown', () => {
    expect(mapStationToken('pgdn')).toEqual({ type: 'pageDown' });
  });

  it('"" (enter) → playSelected', () => {
    expect(mapStationToken('')).toEqual({ type: 'playSelected' });
  });

  it('space → togglePause', () => {
    expect(mapStationToken(' ')).toEqual({ type: 'togglePause' });
  });

  it('/ → setFilter (editing)', () => {
    expect(mapStationToken('/')).toEqual({ type: 'setFilter', value: '', editing: true });
  });

  it('f → setFilter (editing)', () => {
    expect(mapStationToken('f')).toEqual({ type: 'setFilter', value: '', editing: true });
  });

  it('h → shuffle', () => {
    expect(mapStationToken('h')).toEqual({ type: 'shuffle' });
  });

  it('r → replay', () => {
    expect(mapStationToken('r')).toEqual({ type: 'replay' });
  });

  it('s → rate 0', () => {
    expect(mapStationToken('s')).toEqual({ type: 'rate', rating: 0 });
  });

  it('u → rebuild', () => {
    expect(mapStationToken('u')).toEqual({ type: 'rebuild' });
  });

  it('l → like (rate 5)', () => {
    expect(mapStationToken('l')).toEqual({ type: 'rate', rating: 5 });
  });

  it('d → dislike (rate 0)', () => {
    expect(mapStationToken('d')).toEqual({ type: 'rate', rating: 0 });
  });

  it('numeric "2" → rate 2', () => {
    expect(mapStationToken('2')).toEqual({ type: 'rate', rating: 2 });
  });

  it('numeric "5" → rate 5', () => {
    expect(mapStationToken('5')).toEqual({ type: 'rate', rating: 5 });
  });

  it('numeric beyond range → null', () => {
    expect(mapStationToken('9')).toBeNull();
  });

  it('unknown token → null', () => {
    expect(mapStationToken('z')).toBeNull();
  });
});

// ─── decodeTerminalInput ──────────────────────────────────────────────────────

describe('decodeTerminalInput', () => {
  it('empty string → empty array', () => {
    expect(decodeTerminalInput('')).toEqual([]);
  });

  it('plain char → single token', () => {
    expect(decodeTerminalInput('q')).toEqual(['q']);
  });

  it('lowercase letters', () => {
    expect(decodeTerminalInput('abc')).toEqual(['a', 'b', 'c']);
  });

  it('uppercase normalized to lowercase', () => {
    expect(decodeTerminalInput('Q')).toEqual(['q']);
  });

  it('ESC [ C → right arrow', () => {
    expect(decodeTerminalInput('\u001b[C')).toEqual(['right']);
  });

  it('ESC [ D → left arrow', () => {
    expect(decodeTerminalInput('\u001b[D')).toEqual(['left']);
  });

  it('ESC [ A → up arrow', () => {
    expect(decodeTerminalInput('\u001b[A')).toEqual(['up']);
  });

  it('ESC [ B → down arrow', () => {
    expect(decodeTerminalInput('\u001b[B')).toEqual(['down']);
  });

  it('ESC [ 5 ~ → pgup', () => {
    expect(decodeTerminalInput('\u001b[5~')).toEqual(['pgup']);
  });

  it('ESC [ 6 ~ → pgdn', () => {
    expect(decodeTerminalInput('\u001b[6~')).toEqual(['pgdn']);
  });

  it('bare ESC → escape', () => {
    expect(decodeTerminalInput('\u001b')).toEqual(['escape']);
  });

  it('CR → enter (empty string token)', () => {
    expect(decodeTerminalInput('\r')).toEqual(['']);
  });

  it('LF → enter (empty string token)', () => {
    expect(decodeTerminalInput('\n')).toEqual(['']);
  });

  it('DEL (backspace) → backspace', () => {
    expect(decodeTerminalInput('\u007f')).toEqual(['backspace']);
  });

  it('BS char → backspace', () => {
    expect(decodeTerminalInput('\b')).toEqual(['backspace']);
  });

  it('space → space token', () => {
    expect(decodeTerminalInput(' ')).toEqual([' ']);
  });

  it('multiple tokens in sequence', () => {
    // q + right arrow + enter
    expect(decodeTerminalInput('q\u001b[C\r')).toEqual(['q', 'right', '']);
  });

  it('multiple arrows in sequence', () => {
    expect(decodeTerminalInput('\u001b[A\u001b[B')).toEqual(['up', 'down']);
  });
});
