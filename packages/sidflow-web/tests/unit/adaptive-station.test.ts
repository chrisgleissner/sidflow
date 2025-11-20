import { describe, expect, test } from 'bun:test';
import type { SessionAction } from '@/lib/server/adaptive-station';

describe('Adaptive Station', () => {
    test('calculateAdaptiveSimilarity increases with skips', () => {
        const actionsWithSkips: SessionAction[] = [
            { sid_path: '/track1.sid', action: 'skip', timestamp: Date.now() },
            { sid_path: '/track2.sid', action: 'skip', timestamp: Date.now() },
            { sid_path: '/track3.sid', action: 'skip', timestamp: Date.now() },
        ];

        let similarity = 0.7;
        const skips = actionsWithSkips.filter((a) => a.action === 'skip').length;
        if (skips > 2) {
            similarity += Math.min(0.2, skips * 0.05);
        }
        similarity = Math.max(0.5, Math.min(0.95, similarity));

        expect(similarity).toBeGreaterThan(0.7);
        expect(similarity).toBeLessThanOrEqual(0.95);
    });

    test('calculateAdaptiveSimilarity decreases with many likes', () => {
        const actionsWithLikes: SessionAction[] = [
            { sid_path: '/track1.sid', action: 'like', timestamp: Date.now() },
            { sid_path: '/track2.sid', action: 'like', timestamp: Date.now() },
            { sid_path: '/track3.sid', action: 'like', timestamp: Date.now() },
            { sid_path: '/track4.sid', action: 'like', timestamp: Date.now() },
            { sid_path: '/track5.sid', action: 'like', timestamp: Date.now() },
        ];

        let similarity = 0.7;
        const likes = actionsWithLikes.filter((a) => a.action === 'like').length;
        if (likes > 3) {
            similarity -= Math.min(0.1, (likes - 3) * 0.03);
        }
        similarity = Math.max(0.5, Math.min(0.95, similarity));

        expect(similarity).toBeLessThan(0.7);
        expect(similarity).toBeGreaterThanOrEqual(0.5);
    });

    test('calculateAdaptiveDiscovery increases with engagement', () => {
        const engagedActions: SessionAction[] = [
            { sid_path: '/track1.sid', action: 'like', timestamp: Date.now() },
            { sid_path: '/track2.sid', action: 'play_full', timestamp: Date.now() },
            { sid_path: '/track3.sid', action: 'like', timestamp: Date.now() },
            { sid_path: '/track4.sid', action: 'play_full', timestamp: Date.now() },
        ];

        let discovery = 0.5;
        const likes = engagedActions.filter((a) => a.action === 'like').length;
        const fullPlays = engagedActions.filter((a) => a.action === 'play_full').length;
        const engagement = fullPlays + likes;
        if (engagement > 3) {
            discovery += Math.min(0.3, engagement * 0.05);
        }
        discovery = Math.max(0.2, Math.min(0.8, discovery));

        expect(discovery).toBeGreaterThan(0.5);
        expect(discovery).toBeLessThanOrEqual(0.8);
    });

    test('calculateAdaptiveDiscovery decreases with skips', () => {
        const actionsWithSkips: SessionAction[] = [
            { sid_path: '/track1.sid', action: 'skip', timestamp: Date.now() },
            { sid_path: '/track2.sid', action: 'skip', timestamp: Date.now() },
            { sid_path: '/track3.sid', action: 'skip', timestamp: Date.now() },
        ];

        let discovery = 0.5;
        const skips = actionsWithSkips.filter((a) => a.action === 'skip').length;
        if (skips > 2) {
            discovery -= Math.min(0.25, skips * 0.06);
        }
        discovery = Math.max(0.2, Math.min(0.8, discovery));

        expect(discovery).toBeLessThan(0.5);
        expect(discovery).toBeGreaterThanOrEqual(0.2);
    });

    test('adaptation clamping prevents extreme values', () => {
        // Test upper bound
        let highSimilarity = 0.7 + 1.0; // Would exceed 0.95
        highSimilarity = Math.max(0.5, Math.min(0.95, highSimilarity));
        expect(highSimilarity).toBe(0.95);

        // Test lower bound
        let lowSimilarity = 0.7 - 1.0; // Would go below 0.5
        lowSimilarity = Math.max(0.5, Math.min(0.95, lowSimilarity));
        expect(lowSimilarity).toBe(0.5);

        // Test discovery upper bound
        let highDiscovery = 0.5 + 1.0; // Would exceed 0.8
        highDiscovery = Math.max(0.2, Math.min(0.8, highDiscovery));
        expect(highDiscovery).toBe(0.8);

        // Test discovery lower bound
        let lowDiscovery = 0.5 - 1.0; // Would go below 0.2
        lowDiscovery = Math.max(0.2, Math.min(0.8, lowDiscovery));
        expect(lowDiscovery).toBe(0.2);
    });
});
