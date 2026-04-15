/**
 * n8n Community AI Tool Node — Vector Store / Hybrid Search Scaffold
 *
 * Replace all TODO markers with your implementation.
 * Read the SKILL.md + references/native-vs-custom.md before editing.
 *
 * Architecture:
 *   supplyData() ← called ONCE at agent setup. Registers tool name/description/schema.
 *   execute()    ← called EVERY TIME the agent invokes the tool at runtime.
 *                  Also called once during partial workflow run with empty input → must
 *                  return [[]] gracefully (NOT throw).
 */

import type {
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	IExecuteFunctions,
	SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError, nodeNameToToolName } from 'n8n-workflow';

// ─── Your DB client import ────────────────────────────────────────────────────
// TODO: replace with your actual client
// import { YourDbClient } from 'your-db-sdk';

// ─── Embedding / Reranker interfaces ─────────────────────────────────────────
// These mirror the minimal interface n8n exposes via getInputConnectionData.
// Do not import from @n8n/ai-utilities — it is not resolvable from custom nodes.

interface IEmbeddingModel {
	embedQuery(text: string): Promise<number[]>;
}

interface IRerankDocument {
	pageContent: string;
	metadata: Record<string, unknown>;
}

interface IRerankerModel {
	compressDocuments(documents: IRerankDocument[], query: string): Promise<IRerankDocument[]>;
}

// ─── Node class ──────────────────────────────────────────────────────────────

export class MyVectorSearchTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'My Vector Search Tool', // TODO: rename
		name: 'myVectorSearchTool',           // TODO: rename (camelCase, unique)
		icon: 'file:your-icon.svg',           // TODO: add icon or remove line
		group: ['transform'],
		version: 1,
		description: 'Search [your DB] using vector similarity', // TODO
		defaults: { name: 'My Vector Search Tool' },
		// Tool bus wiring — do not change these connection types
		inputs: [
			{ displayName: 'Embeddings', type: NodeConnectionTypes.AiEmbedding, required: true,  maxConnections: 1 },
			{ displayName: 'Reranker',   type: NodeConnectionTypes.AiReranker,  required: false, maxConnections: 1 },
		],
		outputs: [NodeConnectionTypes.AiTool],
		credentials: [
			// TODO: add your credential type(s), or remove this block
			// { name: 'myDbApi', required: true },
		],
		properties: [
			// TODO: add your node-level parameters
			// Example: collection name, top-K, field mappings, etc.
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				default: '',
				placeholder: 'e.g. Search the research database for relevant documents',
				description: 'Shown to the AI Agent so it knows when to call this tool. Leave blank for auto-generated.',
			},
			{
				displayName: 'Collection / Index Name',
				name: 'collectionName',
				type: 'string',
				default: '',
				required: true,
				description: 'TODO: rename to match your DB concept',
			},
			{
				displayName: 'Top K',
				name: 'topK',
				type: 'number',
				default: 10,
				description: 'Maximum number of results to return',
			},
		],
	};

	// ─── supplyData: Phase 1 — register the tool with the agent ──────────────
	//
	// Called ONCE when the AI Agent node initialises.
	// Your job: return a DynamicStructuredTool that describes the tool to the LLM.
	//
	// IMPORTANT:
	//   • Use DynamicStructuredTool (NOT DynamicTool) — the agent sends {input:"..."}, not a raw string.
	//   • Use a plain JSON Schema object for `schema` — do NOT use Zod from require('zod').
	//     Zod loaded from a different module instance fails the instanceof check in LangChain
	//     and produces "schema must be JSON Schema of type object, got type None".
	//   • func() here is a FALLBACK path. In the normal n8n agent flow, execute() handles
	//     runtime invocations. Still implement func() for correctness / future paths.
	//   • addInputData / addOutputData track this path in n8n's execution panel.
	//     logWrapper from @n8n/ai-utilities is NOT importable from custom node paths.

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const collectionName = (this.getNodeParameter('collectionName', itemIndex, '') as string).trim();
		const topK           = this.getNodeParameter('topK', itemIndex, 10) as number;
		const manualDesc     = (this.getNodeParameter('toolDescription', itemIndex, '') as string).trim();

		if (!collectionName) {
			throw new NodeOperationError(this.getNode(), 'Collection / Index Name is required.');
		}

		// Capture embeddings at setup time (same pattern as native nodes)
		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding, 0,
		)) as IEmbeddingModel;

		if (!embeddings) {
			throw new NodeOperationError(this.getNode(), 'Connect an Embeddings model.');
		}

		const reranker = (await this.getInputConnectionData(
			NodeConnectionTypes.AiReranker, 0,
		)) as IRerankerModel | undefined;

		// TODO: build your DB client from credentials
		// const creds = await this.getCredentials('myDbApi');
		// const client = new YourDbClient({ ... });

		const toolName = nodeNameToToolName(this.getNode());
		const toolDescription = manualDesc || `Search "${collectionName}" for relevant documents using vector similarity.`;
		const context = this;

		const { DynamicStructuredTool } = require('@langchain/core/tools') as {
			DynamicStructuredTool: new (config: {
				name: string;
				description: string;
				schema: unknown;
				func: (input: { input: string }) => Promise<string>;
			}) => object;
		};

		const tool = new DynamicStructuredTool({
			name: toolName,
			description: toolDescription,
			// ⚠️ Plain JSON Schema — NOT Zod. See comment above.
			schema: {
				type: 'object',
				properties: {
					input: { type: 'string', description: 'Plain-text query to search for' },
				},
				required: ['input'],
			},
			func: async ({ input }: { input: string }): Promise<string> => {
				// Track in n8n execution panel (replaces logWrapper for this path)
				const { index } = context.addInputData(NodeConnectionTypes.AiTool, [[{ json: { query: input } }]]);
				try {
					const embedding = await embeddings.embedQuery(input);
					// TODO: run your DB query here using `embedding` and `input`
					const results: Array<Record<string, unknown>> = []; // replace with real query

					let reranked = results;
					if (reranker && results.length > 0) {
						const docs = results.map((r) => ({ pageContent: String(r.text ?? ''), metadata: r }));
						const ranked = await reranker.compressDocuments(docs, input);
						reranked = ranked.map((d) => d.metadata as Record<string, unknown>);
					}

					const response = JSON.stringify(reranked.length ? reranked : { message: 'No results found' });
					context.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { response } }]]);
					return response;
				} catch (error) {
					const msg = (error as Error).message;
					context.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { error: msg } }]]);
					return JSON.stringify({ error: msg });
				}
			},
		});

		return { response: tool };
	}

	// ─── execute: Phase 2 — called by makeHandleToolInvocation at runtime ────
	//
	// This is the REAL entry point when the AI Agent invokes the tool.
	// n8n puts the agent's query in getInputData()[0].json.input.
	//
	// MUST handle two contexts:
	//   A) Partial workflow run (setup): items[0].json.input is empty → return [[]] gracefully
	//   B) Agent tool invocation       : items[0].json.input is the query → do real work
	//
	// Output MUST be: [[{ json: { output: "result as string" } }]]
	//                                    ^^^^^^
	//                          The agent reads THIS key specifically.

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const query = ((items[0]?.json?.input as string) || '').trim();

		// Context A: partial run / setup — return gracefully (do NOT throw)
		if (!query) {
			return [[]];
		}

		// Context B: real agent tool invocation
		const itemIndex      = 0;
		const collectionName = (this.getNodeParameter('collectionName', itemIndex, '') as string).trim();
		const topK           = this.getNodeParameter('topK', itemIndex, 10) as number;

		if (!collectionName) {
			return [[{ json: { output: 'Collection / Index Name is required.' } }]];
		}

		// Fetch embeddings — getInputConnectionData works in IExecuteFunctions context ✅
		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding, 0,
		)) as IEmbeddingModel;

		if (!embeddings) {
			return [[{ json: { output: 'No Embeddings model connected.' } }]];
		}

		const reranker = (await this.getInputConnectionData(
			NodeConnectionTypes.AiReranker, 0,
		)) as IRerankerModel | undefined;

		// TODO: build your DB client from credentials
		// const creds = await this.getCredentials('myDbApi');
		// const client = new YourDbClient({ ... });

		try {
			const embedding = await embeddings.embedQuery(query);

			// TODO: run your DB vector search using `embedding`, `query`, `topK`, `collectionName`
			const results: Array<Record<string, unknown>> = []; // replace with real query

			if (!results.length) {
				return [[{ json: { output: JSON.stringify({ message: 'No results found', query }) } }]];
			}

			let reranked = results;
			if (reranker) {
				const docs = results.map((r) => ({ pageContent: String(r.text ?? ''), metadata: r }));
				const ranked = await reranker.compressDocuments(docs, query);
				reranked = ranked.map((d) => d.metadata as Record<string, unknown>);
			}

			// ⚠️ output key MUST be "output" — the agent reads items[0].json.output
			const output = JSON.stringify(reranked);
			return [[{ json: { output } }]];

		} catch (error) {
			const msg = (error as Error).message || String(error);
			return [[{ json: { output: JSON.stringify({ error: msg }) } }]];
		}
	}
}
