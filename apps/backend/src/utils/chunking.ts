export interface ChunkUnit {
	chunkIndex: number;
	startLine: number;
	endLine: number;
	content: string;
	symbolName: string | null;
}

const detectSymbol = (line: string): string | null => {
	const trimmed = line.trim();
	const patterns = [
		/function\s+([A-Za-z0-9_]+)/,
		/class\s+([A-Za-z0-9_]+)/,
		/const\s+([A-Za-z0-9_]+)\s*=\s*\(/,
		/export\s+const\s+([A-Za-z0-9_]+)/,
	];

	for (const pattern of patterns) {
		const match = trimmed.match(pattern);
		if (match?.[1]) return match[1];
	}

	return null;
};

export function chunkText(content: string, maxLines = 80, overlap = 15): ChunkUnit[] {
	const lines = content.split(/\r?\n/);
	if (!lines.length) {
		return [];
	}

	const chunks: ChunkUnit[] = [];
	let index = 0;
	let start = 0;

	while (start < lines.length) {
		const end = Math.min(lines.length, start + maxLines);
		const part = lines.slice(start, end);
		let symbol: string | null = null;

		for (let i = 0; i < part.length; i += 1) {
			symbol = detectSymbol(part[i]) ?? symbol;
		}

		chunks.push({
			chunkIndex: index,
			startLine: start + 1,
			endLine: end,
			content: part.join('\n'),
			symbolName: symbol,
		});

		if (end >= lines.length) break;
		start = Math.max(end - overlap, start + 1);
		index += 1;
	}

	return chunks;
}
