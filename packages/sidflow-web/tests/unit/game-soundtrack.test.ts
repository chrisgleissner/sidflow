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

    test('normalizeGameTitle handles null and undefined', () => {
        expect(normalizeGameTitle(null)).toBe('');
        expect(normalizeGameTitle(undefined)).toBe('');
        expect(normalizeGameTitle('')).toBe('');
    });

    test('normalizeGameTitle removes brackets and parentheses', () => {
        expect(normalizeGameTitle('Game (1984)')).toBe('game 1984');
        expect(normalizeGameTitle('Game [Remix]')).toBe('game remix');
        expect(normalizeGameTitle('Game {Special}')).toBe('game special');
    });

    test('normalizeGameTitle normalizes spaces', () => {
        expect(normalizeGameTitle('Game  Title')).toBe('game title');
        expect(normalizeGameTitle('Game   --   Title')).toBe('game title');
        expect(normalizeGameTitle('  Game Title  ')).toBe('game title');
    });

    test('extractGameTitle handles deep paths', () => {
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
        expect(extractGameTitle(metadata, '/very/deep/path/Commando/track.sid')).toBe('Commando');
    });

    test('extractGameTitle handles special characters in folders', () => {
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
        expect(extractGameTitle(metadata, '/path/Game-Title!/music.sid')).toBe('GameTitle');
        expect(extractGameTitle(metadata, '/path/Game_(1984)/track.sid')).toBe('Game 1984');
    });
});
