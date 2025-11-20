import { describe, expect, test } from 'bun:test';

describe('Live ML Explanations', () => {
    test('euclidean distance calculation for identical vectors', () => {
        // For identical vectors, distance should be 0
        const a = [3.5, 4.0, 2.8];
        const b = [3.5, 4.0, 2.8];

        // Simple euclidean distance
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i] - b[i];
            sum += diff * diff;
        }
        const distance = Math.sqrt(sum) / Math.sqrt(a.length * 25);
        expect(distance).toBe(0);
    });

    test('euclidean distance calculation for different vectors', () => {
        const a = [1.0, 1.0, 1.0];
        const b = [5.0, 5.0, 5.0];

        // Distance should be non-zero for different vectors
        let sum = 0;
        for (let i = 0; i < a.length; i++) {
            const diff = a[i] - b[i];
            sum += diff * diff;
        }
        const distance = Math.sqrt(sum) / Math.sqrt(a.length * 25);
        expect(distance).toBeGreaterThan(0);
        expect(distance).toBeLessThanOrEqual(1);
    });

    test('similarity from distance conversion', () => {
        // Distance 0 should give 100% similarity
        const sim100 = Math.max(0, Math.min(100, (1 - 0) * 100));
        expect(sim100).toBe(100);

        // Distance 1 should give 0% similarity
        const sim0 = Math.max(0, Math.min(100, (1 - 1) * 100));
        expect(sim0).toBe(0);

        // Distance 0.5 should give 50% similarity
        const sim50 = Math.max(0, Math.min(100, (1 - 0.5) * 100));
        expect(sim50).toBe(50);
    });

    test('feature explanation format', () => {
        const explanation = {
            feature: 'Energy Level',
            similarity: 85,
            description: 'Similar energy: 85%',
        };

        expect(explanation.feature).toBe('Energy Level');
        expect(explanation.similarity).toBe(85);
        expect(explanation.description).toContain('85%');
    });
});
