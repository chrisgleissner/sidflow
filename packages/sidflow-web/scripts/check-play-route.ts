import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/play/route';

// Simple manual harness to invoke the play route without starting Next.js

async function main() {
    const sidPath = path.resolve(
        process.cwd(),
        '..',
        '..',
        'workspace',
        'hvsc',
        'C64Music',
        'MUSICIANS',
        'H',
        'Hubbard_Rob',
        'Commando.sid',
    );
    const payload = {
        sid_path: sidPath,
    };
    const request = new NextRequest('http://sidflow.local/api/play', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
            'content-type': 'application/json',
        },
    });
    const response = await POST(request);
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
}

main().catch((error) => {
    console.error('Failed to invoke play route', error);
    process.exitCode = 1;
});
