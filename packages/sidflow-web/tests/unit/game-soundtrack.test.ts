import { describe, expect, test } from 'bun:test';
import { normalizeGameTitle, extractGameTitle } from '@/lib/server/game-soundtrack';

describe('Game Soundtrack helpers', () => {
    test('normalizeGameTitle removes punctuation and lowercases', () => {
        expect(normalizeGameTitle('The Last Ninja')).toBe('the last ninja');
        expect(normalizeGameTitle('Monty on the Run!')).toBe('monty on the run');
        expect(normalizeGameTitle('R-TYPE [C64]')).toBe('r type c64');
    });

    test('extractGameTitle from metadata title', () => {
        const metadata = {
            title: 'Last Ninja Theme',
            author: 'Matt Gray',
            released: '1987',
            songs: 1,
            startSong: 1,
            sidType: 'PSID',
            version: 2,
            sidModel: '6581',
            clock: 'PAL',
            length: '03:00',
            fileSizeBytes: 4096,
        };
        const title = extractGameTitle(metadata, '/hvsc/MUSICIANS/Gray_Matt/Last_Ninja.sid');
        expect(title).toBe('Last Ninja Theme');
    });

    test('extractGameTitle from path when no metadata title', () => {
        const metadata = {
            title: '',
            author: 'Matt Gray',
            released: '1987',
            songs: 1,
            startSong: 1,
            sidType: 'PSID',
            version: 2,
            sidModel: '6581',
            clock: 'PAL',
            length: '03:00',
            fileSizeBytes: 4096,
        };
        const title = extractGameTitle(metadata, '/hvsc/GAMES/M-Z/Monty_on_the_Run/music.sid');
        expect(title).toBe('Monty on the Run');
    });

    test('extractGameTitle handles edge cases', () => {
        const metadata = {
            title: '',
            author: '',
            released: '',
            songs: 1,
            startSong: 1,
            sidType: 'PSID',
            version: 2,
            sidModel: '6581',
            clock: 'PAL',
            length: '',
            fileSizeBytes: 0,
        };
        // Single directory component
        const title = extractGameTitle(metadata, '/music.sid');
        expect(title).toBe('');
    });
});
