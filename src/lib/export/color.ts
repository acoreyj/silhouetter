export interface RGB {
	r: number;
	g: number;
	b: number;
}

/** Parse a hex colour (#rgb, #rrggbb) into 0..1 RGB components. */
export function hexToRgb(hex: string, fallback: RGB = { r: 0, g: 0, b: 0 }): RGB {
	if (!hex) return fallback;
	let value = hex.trim().replace(/^#/, '');
	if (value.length === 3) {
		value = value
			.split('')
			.map((c) => c + c)
			.join('');
	}
	if (!/^[0-9a-fA-F]{6}$/.test(value)) return fallback;
	return {
		r: parseInt(value.slice(0, 2), 16) / 255,
		g: parseInt(value.slice(2, 4), 16) / 255,
		b: parseInt(value.slice(4, 6), 16) / 255
	};
}
