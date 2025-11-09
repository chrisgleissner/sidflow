/**
 * Generate a synthetic SID file that plays a continuous C4 (261.63 Hz) tone
 * for at least 3 seconds using a triangle waveform.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

// SID frequency calculation for PAL (985248 Hz clock)
// FREQ = (note_hz * 2^24) / 985248
// For C4 (261.63 Hz): (261.63 * 16777216) / 985248 = 4456.89 ≈ 0x1169

const C4_FREQ_PAL = 0x113E; // From the frequency table provided (4414 decimal)

function generateSidFile(): Uint8Array {
    // PSID v2 format
    const buffer = new Uint8Array(0x7C + 256); // Header + minimal code

    // Magic bytes "PSID"
    buffer[0] = 0x50; // 'P'
    buffer[1] = 0x53; // 'S'
    buffer[2] = 0x49; // 'I'
    buffer[3] = 0x44; // 'D'

    // Version (2 = PSID v2)
    buffer[4] = 0x00;
    buffer[5] = 0x02;

    // Data offset (0x007C = 124 bytes)
    buffer[6] = 0x00;
    buffer[7] = 0x7C;

    // Load address (0x1000)
    buffer[8] = 0x10;
    buffer[9] = 0x00;

    // Init address (0x1000)
    buffer[10] = 0x10;
    buffer[11] = 0x00;

    // Play address points to dedicated RTS after init (0x101F)
    buffer[12] = 0x10;
    buffer[13] = 0x1F;

    // Songs (1)
    buffer[14] = 0x00;
    buffer[15] = 0x01;

    // Start song (1)
    buffer[16] = 0x00;
    buffer[17] = 0x01;

    // Speed flag: 0x0001 -> use default timer (CIA) for play routine
    buffer[18] = 0x00;
    buffer[19] = 0x00;
    buffer[20] = 0x00;
    buffer[21] = 0x01;

    // Name: "Test Tone C4" (32 bytes at offset 0x16)
    const name = "Test Tone C4";
    for (let i = 0; i < name.length && i < 32; i++) {
        buffer[0x16 + i] = name.charCodeAt(i);
    }

    // Author: "SIDFlow" (32 bytes at offset 0x36)
    const author = "SIDFlow";
    for (let i = 0; i < author.length && i < 32; i++) {
        buffer[0x36 + i] = author.charCodeAt(i);
    }

    // Released: "2025" (32 bytes at offset 0x56)
    const released = "2025";
    for (let i = 0; i < released.length && i < 32; i++) {
        buffer[0x56 + i] = released.charCodeAt(i);
    }

    // Flags (PAL = bit 2-3 = 01)
    buffer[0x76] = 0x00;
    buffer[0x77] = 0x04; // PAL flag

    // 6502 machine code starts at offset 0x7C (load address 0x1000)
    let codeOffset = 0x7C;

    // INIT routine (0x1000): Set up SID registers for C4 triangle wave
    const code = [
        // Map SID I/O into memory ($D000-$DFFF)
        0xA9, 0x35,       // LDA #$35 (I/O, Kernal, Basic)
        0x85, 0x01,       // STA $01 (memory config)

        // Set volume to maximum (15)
        0xA9, 0x0F,       // LDA #$0F
        0x8D, 0x18, 0xD4, // STA $D418 (Mode/Volume)

        // Voice 1: C4 frequency (0x113E = 4414)
        0xA9, 0x3E,       // LDA #$3E (low byte)
        0x8D, 0x00, 0xD4, // STA $D400 (Voice 1 Freq Lo)
        0xA9, 0x11,       // LDA #$11 (high byte)
        0x8D, 0x01, 0xD4, // STA $D401 (Voice 1 Freq Hi)

        // Pulse width 50% (0x0800)
        0xA9, 0x00,       // LDA #$00 (width lo)
        0x8D, 0x02, 0xD4, // STA $D402 (Voice 1 PW Lo)
        0xA9, 0x08,       // LDA #$08 (width hi)
        0x8D, 0x03, 0xD4, // STA $D403 (Voice 1 PW Hi)

        // Set Attack/Decay (instant attack, no decay)
        0xA9, 0x00,       // LDA #$00 (A=0, D=0)
        0x8D, 0x05, 0xD4, // STA $D405 (Voice 1 AD)

        // Set Sustain/Release (full sustain, no release)
        0xA9, 0xF0,       // LDA #$F0 (S=F, R=0)
        0x8D, 0x06, 0xD4, // STA $D406 (Voice 1 SR)

        // Prime voice control: reset oscillator then enable pulse waveform + gate
        0xA9, 0x08,       // LDA #$08 (Test bit)
        0x8D, 0x04, 0xD4, // STA $D404 (Voice 1 Control)
        0xA9, 0x00,       // LDA #$00 (clear gate)
        0x8D, 0x04, 0xD4, // STA $D404 (Voice 1 Control)
        0xA9, 0x41,       // LDA #$41 (Pulse + Gate)
        0x8D, 0x04, 0xD4, // STA $D404 (Voice 1 Control)

        0x60,             // RTS (return from init)

        // PLAY routine (0x101F): Re-assert gate every frame to guarantee sustain
        0xA9, 0x41,       // LDA #$41 (Pulse + Gate)
        0x8D, 0x04, 0xD4, // STA $D404 (Voice 1 Control)
        0x60              // RTS
    ];

    // Write the code
    for (let i = 0; i < code.length; i++) {
        buffer[codeOffset + i] = code[i];
    }

    return buffer;
}

// Generate and save
const sidData = generateSidFile();
const outputPath = join(import.meta.dir, '../test-tone-c4.sid');
writeFileSync(outputPath, sidData);

console.log(`✓ Generated synthetic C4 SID file: ${outputPath}`);
console.log(`  Frequency: ${C4_FREQ_PAL} (0x${C4_FREQ_PAL.toString(16)})`);
console.log(`  Waveform: Pulse 50%`);
console.log(`  Duration: Continuous (until stopped)`);
console.log(`  File size: ${sidData.length} bytes`);
