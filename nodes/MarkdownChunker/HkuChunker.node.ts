import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// ========== Helper Functions ==========

function isBlank(line: string): boolean {
	return !line || /^\s*$/.test(line);
}

function isFenceStart(line: string): { indent: string; fence: string; info: string } | null {
	const m = line.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
	if (!m) return null;
	return { indent: m[1] ?? '', fence: m[2], info: m[3]?.trim() ?? '' };
}

function isFenceEnd(line: string, fence: string): boolean {
	return new RegExp(`^\\s*${fence}\\s*$`).test(line);
}

function isHeadingAtx(line: string): { level: number; text: string } | null {
	const m = line.match(/^\s*(#{1,6})\s+(.*)$/);
	if (!m) return null;
	return { level: m[1].length, text: m[2].trim() };
}

function isHeadingSetext(line: string, nextLine?: string): { level: number; text: string } | null {
	if (!nextLine) return null;
	const underline = nextLine.match(/^\s*(=+|-+)\s*$/);
	if (!underline) return null;
	const level = underline[1].startsWith('=') ? 1 : 2;
	const text = line.trim();
	if (!text) return null;
	return { level, text };
}

function isTableSeparator(line: string): boolean {
	return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isLikelyTableRow(line: string): boolean {
	return /\|/.test(line) && !isFenceStart(line);
}

function isHr(line: string): boolean {
	return /^\s*(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/.test(line);
}

function isImageLine(line: string): boolean {
	return /!\[[^\]]*]\([^)]+\)/.test(line);
}

function splitIntoSentences(text: string): string[] {
	const sentences: string[] = [];
	let start = 0;
	const abbrev = new Set([
		'mr',
		'mrs',
		'ms',
		'dr',
		'prof',
		'sr',
		'jr',
		'st',
		'vs',
		'etc',
		'e.g',
		'eg',
		'i.e',
		'ie',
		'jan',
		'feb',
		'mar',
		'apr',
		'aug',
		'sept',
		'oct',
		'nov',
		'dec',
	]);

	const lastWordBefore = (idx: number): string => {
		const slice = text.slice(Math.max(0, idx - 20), idx);
		const m = slice.match(/([A-Za-z]{1,10})$/);
		return m ? m[1].toLowerCase() : '';
	};

	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '.' || ch === '!' || ch === '?') {
			const prevWord = lastWordBefore(i);
			const isAbbrev = abbrev.has(prevWord);
			const isNumberDot = /\d\.\d/.test(text.slice(i - 1, i + 2));
			if (isAbbrev || isNumberDot) {
				i++;
				continue;
			}

			// Include trailing quotes/brackets
			let j = i + 1;
			while (j < text.length && `"''")]`.includes(text[j])) j++;

			// Also include the original trailing whitespace after the sentence end
			let k = j;
			while (k < text.length && /\s/.test(text[k])) k++;

			const sentenceChunk = text.slice(start, k);
			if (sentenceChunk.length > 0) sentences.push(sentenceChunk);

			start = k;
			i = k;
			continue;
		}
		i++;
	}

	// Tail (could be text without terminal punctuation)
	if (start < text.length) {
		sentences.push(text.slice(start));
	}
	return sentences;
}

function parseMarkdownToUnits(md: string): any[] {
	const lines = md.split(/\r?\n/);
	const units: any[] = [];
	let i = 0;

	// Track header path
	const headerPath: (string | undefined)[] = [];
	const snapshotHeaderPath = (): string[] => {
		return headerPath.filter(Boolean) as string[];
	};

	while (i < lines.length) {
		const line = lines[i];

		// Code fence block
		const fenceStart = isFenceStart(line);
		if (fenceStart) {
			const fence = fenceStart.fence;
			const startIdx = i;
			i++;
			while (i < lines.length && !isFenceEnd(lines[i], fence)) i++;
			if (i < lines.length) i++; // Include closing fence
			const content = lines.slice(startIdx, i).join('\n');
			units.push({
				type: 'block',
				blockType: 'code',
				content,
				headerPath: snapshotHeaderPath(),
			});
			continue;
		}

		// Heading (ATX or Setext)
		const atx = isHeadingAtx(line);
		const setext = !atx ? isHeadingSetext(line, lines[i + 1]) : null;
		if (atx || setext) {
			const level = atx ? atx.level : setext!.level;
			const text = atx ? atx.text : setext!.text;
			headerPath[level - 1] = text;
			for (let l = level; l < 6; l++) headerPath[l] = undefined;

			if (setext) {
				const content = `${line}\n${lines[i + 1]}`;
				units.push({
					type: 'block',
					blockType: 'heading',
					level,
					content,
					headerPath: snapshotHeaderPath(),
				});
				i += 2;
			} else {
				units.push({
					type: 'block',
					blockType: 'heading',
					level,
					content: line,
					headerPath: snapshotHeaderPath(),
				});
				i += 1;
			}
			continue;
		}

		// Horizontal rule
		if (isHr(line)) {
			units.push({
				type: 'block',
				blockType: 'hr',
				content: line,
				headerPath: snapshotHeaderPath(),
			});
			i++;
			continue;
		}

		// Table block
		if (
			isLikelyTableRow(line) &&
			(isTableSeparator(lines[i + 1] || '') || isTableSeparator(lines[i + 2] || ''))
		) {
			const start = i;
			i++;
			while (i < lines.length && !isBlank(lines[i]) && isLikelyTableRow(lines[i])) {
				i++;
			}
			const content = lines.slice(start, i).join('\n');
			units.push({
				type: 'block',
				blockType: 'table',
				content,
				headerPath: snapshotHeaderPath(),
			});
			continue;
		}

		// Image as standalone line
		if (
			isImageLine(line) &&
			(isBlank(lines[i - 1]) || i === 0) &&
			(isBlank(lines[i + 1]) || i === lines.length - 1)
		) {
			units.push({
				type: 'block',
				blockType: 'image',
				content: line,
				headerPath: snapshotHeaderPath(),
			});
			i++;
			continue;
		}

		// Paragraph / list / mixed text
		if (!isBlank(line)) {
			const start = i;
			i++;
			while (
				i < lines.length &&
				!isBlank(lines[i]) &&
				!isFenceStart(lines[i]) &&
				!isHeadingAtx(lines[i]) &&
				!isHeadingSetext(lines[i], lines[i + 1]) &&
				!(
					isLikelyTableRow(lines[i]) &&
					(isTableSeparator(lines[i + 1] || '') || isTableSeparator(lines[i + 2] || ''))
				) &&
				!isHr(lines[i])
			) {
				i++;
			}
			const blockText = lines.slice(start, i).join('\n');

			// If this block is a single image line, keep atomic
			if (isImageLine(blockText) && !blockText.includes('\n')) {
				units.push({
					type: 'block',
					blockType: 'image',
					content: blockText,
					headerPath: snapshotHeaderPath(),
				});
			} else {
				// Split this block by sentences and preserve trailing whitespace
				const sentences = splitIntoSentences(blockText);
				if (sentences.length === 0) {
					units.push({
						type: 'block',
						blockType: 'paragraph',
						content: blockText,
						headerPath: snapshotHeaderPath(),
					});
				} else {
					sentences.forEach((s) => {
						units.push({ type: 'sentence', content: s, headerPath: snapshotHeaderPath() });
					});
				}
			}
			continue;
		}

		// Blank line - preserve as its own unit
		if (isBlank(line)) {
			units.push({ type: 'sentence', content: line, headerPath: snapshotHeaderPath() });
		}

		i++;
	}

	return units;
}

function packUnits(
	units: any[],
	config: { maxChars: number; minChars: number },
): Array<{ id: number; content: string; headerPath: string[] }> {
	const chunks: Array<{ content: string; headerPath: string[] }> = [];
	let buf: any[] = [];
	let bufLen = 0;
	let lastHeaderPath: string[] = [];

	const flush = () => {
		if (buf.length === 0) return;
		const content = buf.map((u) => u.content).join('');
		const headerPath = lastHeaderPath.length > 0 ? lastHeaderPath : buf[0]?.headerPath || [];
		chunks.push({ content, headerPath });
		buf = [];
		bufLen = 0;
	};

	for (const u of units) {
		if (u.type === 'block' && u.blockType === 'heading') {
			lastHeaderPath = u.headerPath || lastHeaderPath;
			if (bufLen > 0 && bufLen + u.content.length > config.maxChars) flush();
			if (bufLen > 0) flush();
			buf.push(u);
			bufLen += u.content.length;
			flush(); // Heading as its own chunk
			continue;
		}

		const unitLen = u.content.length;

		// If adding this unit would exceed maxChars, flush first
		if (bufLen > 0 && bufLen + unitLen > config.maxChars) {
			flush();
		}

		// If this single unit is larger than maxChars, make it its own chunk
		if (unitLen >= config.maxChars && bufLen === 0) {
			chunks.push({ content: u.content, headerPath: u.headerPath || lastHeaderPath || [] });
			continue;
		}

		buf.push(u);
		bufLen += unitLen;

		// Flush after specific block types OR when buffer reaches maxChars
		if (
			u.type === 'block' &&
			(u.blockType === 'table' ||
				u.blockType === 'code' ||
				u.blockType === 'image' ||
				u.blockType === 'hr')
		) {
			flush();
		} else if (bufLen >= config.maxChars) {
			// Also flush if we've reached the max size
			flush();
		}
	}
	flush();

	// Merge tiny chunks forward when safe
	const merged: Array<{ content: string; headerPath: string[] }> = [];
	for (const c of chunks) {
		if (merged.length === 0) {
			merged.push(c);
			continue;
		}
		const prev = merged[merged.length - 1];
		if (
			prev.content.length < config.minChars &&
			prev.content.length + c.content.length <= config.maxChars
		) {
			prev.content = `${prev.content}${c.content}`;
		} else {
			merged.push(c);
		}
	}

	return merged.map((c, idx) => ({
		id: idx + 1,
		content: c.content,
		headerPath: (c.headerPath || []).filter(Boolean) as string[],
	}));
}

// ========== Node Class ==========

export class HkuChunker implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HKU Markdown Chunker',
		name: 'hkuChunker',
		icon: { light: 'file:chunking.svg', dark: 'file:lightChunking.svg' },
		group: ['transform'],
		version: 1,
		description:
			'Markdown-aware chunker for RAG - splits text intelligently without breaking structure',
		defaults: {
			name: 'HKU Markdown Chunker',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Markdown Text',
				name: 'markdownText',
				type: 'string',
				default: '',
				required: true,
				description: 'The markdown text to be chunked',
				placeholder: '# My Document\n\nThis is some markdown text...',
			},
			{
				displayName: 'Original File Name',
				name: 'originalFileName',
				type: 'string',
				default: '',
				required: true,
				description: 'The original file name (used for naming chunks)',
				placeholder: 'document.md',
			},
			{
				displayName: 'Max Characters Per Chunk',
				name: 'maxChars',
				type: 'number',
				default: 5000,
				required: true,
				description: 'Target maximum characters per chunk',
				typeOptions: {
					minValue: 100,
					maxValue: 8000,
				},
			},
			{
				displayName: 'Min Characters Per Chunk',
				name: 'minChars',
				type: 'number',
				default: 1000,
				required: true,
				description: 'Minimum characters per chunk (to avoid tiny chunks)',
				typeOptions: {
					minValue: 0,
					maxValue: 8000,
				},
			},
			{
				displayName: 'Output Options',
				name: 'outputOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Output Format',
						name: 'outputFormat',
						type: 'options',
						options: [
							{
								name: 'Separate Items',
								value: 'separate',
								description: 'Output each chunk as a separate item',
							},
							{
								name: 'Single Item with Array',
								value: 'array',
								description: 'Output all chunks in a single item with chunks array',
							},
						],
						default: 'array',
						description: 'How to format the output',
					},
					{
						displayName: 'Include Metadata',
						name: 'includeMetadata',
						type: 'boolean',
						default: true,
						description: 'Whether to include metadata (size, headerPath) in output',
					},
					{
						displayName: 'Custom Key',
						name: 'customKey',
						type: 'string',
						default: '',
						description: 'Optional custom key to wrap the chunks data',
						placeholder: 'chunkedData',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				// Get input parameters
				const markdownText = this.getNodeParameter('markdownText', i) as string;
				const originalFileName = this.getNodeParameter('originalFileName', i) as string;
				const maxChars = this.getNodeParameter('maxChars', i) as number;
				const minChars = this.getNodeParameter('minChars', i) as number;
				const outputOptions = this.getNodeParameter('outputOptions', i, {}) as {
					outputFormat?: string;
					includeMetadata?: boolean;
					customKey?: string;
				};

				// Validate inputs
				if (!markdownText) {
					throw new NodeOperationError(this.getNode(), 'Markdown text is required', {
						itemIndex: i,
					});
				}

				if (!originalFileName) {
					throw new NodeOperationError(this.getNode(), 'Original file name is required', {
						itemIndex: i,
					});
				}

				if (minChars > maxChars) {
					throw new NodeOperationError(
						this.getNode(),
						'Minimum characters cannot be greater than maximum characters',
						{ itemIndex: i },
					);
				}

				// Configure chunker
				const config = {
					maxChars,
					minChars,
				};

				// Parse and chunk the markdown
				const units = parseMarkdownToUnits(markdownText);
				const chunks = packUnits(units, config);

				// Map to output shape
				const outputChunks = chunks.map(
					(c: { id: number; content: string; headerPath: string[] }) => {
						const chunk: any = {
							id: c.id,
							name: `${originalFileName}_chunk_${c.id}`,
							content: c.content,
						};

						if (outputOptions.includeMetadata !== false) {
							chunk.headerPath = c.headerPath;
							chunk.size = c.content.length;
						}

						return chunk;
					},
				);

				// Format output based on user preference
				const outputFormat = outputOptions.outputFormat || 'array';

				if (outputFormat === 'separate') {
					// Output each chunk as a separate item
					for (const chunk of outputChunks) {
						const outputData: any = outputOptions.customKey
							? { [outputOptions.customKey]: chunk }
							: chunk;

						returnData.push({
							json: outputData,
							pairedItem: { item: i },
						});
					}
				} else {
					// Output all chunks in a single item
					const outputData: any = {
						name: originalFileName,
						totalChunks: outputChunks.length,
						chunks: outputChunks,
					};

					const finalOutput = outputOptions.customKey
						? { [outputOptions.customKey]: outputData }
						: outputData;

					returnData.push({
						json: finalOutput,
						pairedItem: { item: i },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: error.message,
						},
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
