import { describe, expect, it } from 'vitest';
import { hexToRgb } from './color';

describe('hexToRgb', () => {
	it('parses six-digit hex', () => {
		expect(hexToRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
		expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 1, b: 0 });
	});

	it('expands three-digit hex', () => {
		expect(hexToRgb('#fff')).toEqual({ r: 1, g: 1, b: 1 });
	});

	it('falls back on invalid input', () => {
		expect(hexToRgb('not-a-colour', { r: 0.1, g: 0.2, b: 0.3 })).toEqual({
			r: 0.1,
			g: 0.2,
			b: 0.3
		});
	});
});
