import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	SupplyData,
	INodeExecutionData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { CosmosClient } from '@azure/cosmos';
import type { TokenCredential } from '@azure/core-auth';

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

class N8nCosmosTokenCredential implements TokenCredential {
	constructor(
		private accessToken: string,
		private expiresAt?: string,
	) {
		this.accessToken = accessToken.replace(/^Bearer\s+/i, '');
	}

	async getToken() {
		return {
			token: this.accessToken,
			expiresOnTimestamp: this.expiresAt
				? new Date(this.expiresAt).getTime()
				: Date.now() + 3600 * 1000,
		};
	}
}

function getValueByPath(source: unknown, path: string): unknown {
	if (!path) {
		return source;
	}

	return path.split('.').reduce<unknown>((current, segment) => {
		if (current === null || current === undefined) {
			return undefined;
		}

		if (Array.isArray(current)) {
			const index = Number(segment);
			return Number.isInteger(index) ? current[index] : undefined;
		}

		if (typeof current === 'object') {
			return (current as Record<string, unknown>)[segment];
		}

		return undefined;
	}, source);
}

function valueToRerankText(value: unknown): string {
	if (value === null || value === undefined) {
		return '';
	}

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	return JSON.stringify(value);
}

async function rerankDocuments<T extends Record<string, unknown>>(
	documents: T[],
	reranker: IRerankerModel | undefined,
	query: string,
	preferredTextPath = '',
): Promise<T[]> {
	if (!reranker || documents.length === 0 || !query.trim()) {
		return documents;
	}

	const rerankInput: IRerankDocument[] = documents.map((document, index) => {
		const preferredValue = preferredTextPath
			? getValueByPath(document, preferredTextPath)
			: undefined;
		return {
			pageContent: valueToRerankText(preferredValue ?? document),
			metadata: { documentIndex: index },
		};
	});

	const reranked = await reranker.compressDocuments(rerankInput, query);
	const orderedDocuments: T[] = [];
	const usedIndexes = new Set<number>();

	for (const document of reranked) {
		const indexValue = Number(document.metadata.documentIndex);
		if (!Number.isInteger(indexValue) || usedIndexes.has(indexValue)) {
			continue;
		}

		const originalDocument = documents[indexValue];
		if (!originalDocument) {
			continue;
		}

		usedIndexes.add(indexValue);
		orderedDocuments.push(originalDocument);
	}

	for (const [index, document] of documents.entries()) {
		if (!usedIndexes.has(index)) {
			orderedDocuments.push(document);
		}
	}

	return orderedDocuments;
}

export class CosmosDbTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Cosmos DB Tool',
		name: 'cosmosDbTool',
		icon: { light: 'file:database.svg', dark: 'file:lightDatabase.svg' },
		group: ['transform'],
		version: 1,
		description: 'Cosmos DB retrieval tool for AI Agent workflows',
		defaults: { name: 'Cosmos DB Tool' },
		usableAsTool: true,
		inputs: [
			{
				displayName: 'Embeddings',
				type: NodeConnectionTypes.AiEmbedding,
				required: false,
				maxConnections: 1,
			},
			{
				displayName: 'Reranker',
				type: NodeConnectionTypes.AiReranker,
				required: false,
				maxConnections: 1,
			},
		],
		outputs: [NodeConnectionTypes.AiTool],
		credentials: [
			{
				name: 'cosmosDbApi',
				required: true,
				displayOptions: {
					show: {
						authenticationType: ['masterKey'],
					},
				},
			},
			{
				name: 'cosmosDbEntraIdApi',
				required: true,
				displayOptions: {
					show: {
						authenticationType: ['entraId'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Authentication Type',
				name: 'authenticationType',
				type: 'options',
				options: [
					{ name: 'Master Key', value: 'masterKey' },
					{ name: 'Microsoft Entra ID (Azure AD)', value: 'entraId' },
				],
				default: 'masterKey',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [
					{ name: 'Select', value: 'select', action: 'Select documents' },
					{ name: 'Hybrid Search', value: 'hybridSearch', action: 'Hybrid search documents' },
				],
				default: 'select',
				noDataExpression: true,
			},
			{
				displayName: 'Database Name',
				name: 'databaseName',
				type: 'string',
				default: '',
				required: true,
			},
			{
				displayName: 'Container Name',
				name: 'containerName',
				type: 'string',
				default: '',
				required: true,
			},
			{
				displayName: 'SQL Query',
				name: 'sqlQuery',
				type: 'string',
				typeOptions: { rows: 5 },
				default: 'SELECT * FROM c',
				displayOptions: { show: { operation: ['select'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: true,
				displayOptions: { show: { operation: ['select'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				displayOptions: { show: { operation: ['select'], returnAll: [false] } },
			},
			{
				displayName: 'Keyword (Full Text Search)',
				name: 'keyword',
				type: 'string',
				default: '',
				description: 'Default full-text keywords. The AI tool caller can override this.',
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Search Query (Vector Search)',
				name: 'searchQuery',
				type: 'string',
				default: '',
				description: 'Default semantic search query. The AI tool caller can override this.',
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Vector Field Name',
				name: 'hybridVectorFieldName',
				type: 'string',
				default: 'vector',
				required: true,
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Full Text Field Name',
				name: 'hybridTextFieldName',
				type: 'string',
				default: 'text',
				required: true,
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Top K',
				name: 'topK',
				type: 'number',
				default: 10,
				typeOptions: { minValue: 1, maxValue: 1000 },
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Partition Key Field',
				name: 'partitionKeyField',
				type: 'string',
				default: 'category',
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Partition Key Value',
				name: 'partitionKeyValue',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Additional SQL Filters',
				name: 'additionalFilters',
				type: 'string',
				default: '',
				typeOptions: { rows: 3 },
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Fields to Return',
				name: 'fieldsToReturn',
				type: 'string',
				default: '',
				displayOptions: { show: { operation: ['hybridSearch'] } },
			},
			{
				displayName: 'Simplify Output',
				name: 'simplifyOutput',
				type: 'boolean',
				default: true,
			},
			{
				displayName: 'Exclude Fields',
				name: 'excludeFields',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Fields to Exclude',
				name: 'fieldsToExclude',
				type: 'string',
				default: 'vector,text',
				displayOptions: { show: { excludeFields: [true] } },
			},
			{
				displayName: 'Use Dev Override (Custom Endpoint + Token)',
				name: 'useDevOverride',
				type: 'boolean',
				default: false,
			},
			{
				displayName: 'Custom Endpoint',
				name: 'customEndpoint',
				type: 'string',
				default: '',
				displayOptions: { show: { useDevOverride: [true] } },
			},
			{
				displayName: 'Custom Access Token',
				name: 'customAccessToken',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { show: { useDevOverride: [true] } },
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const operation = this.getNodeParameter('operation', itemIndex, 'select') as string;
		const authenticationType = this.getNodeParameter(
			'authenticationType',
			itemIndex,
			'masterKey',
		) as string;
		const customEndpoint = (
			this.getNodeParameter('customEndpoint', itemIndex, '') as string
		).trim();
		const customAccessToken = (
			this.getNodeParameter('customAccessToken', itemIndex, '') as string
		).trim();
		const databaseName = (this.getNodeParameter('databaseName', itemIndex, '') as string).trim();
		const containerName = (this.getNodeParameter('containerName', itemIndex, '') as string).trim();
		const simplifyOutput = this.getNodeParameter('simplifyOutput', itemIndex, true) as boolean;
		const excludeFields = this.getNodeParameter('excludeFields', itemIndex, false) as boolean;
		const fieldsToExclude = this.getNodeParameter('fieldsToExclude', itemIndex, '') as string;

		if (!databaseName || !containerName) {
			throw new NodeOperationError(
				this.getNode(),
				'Database Name and Container Name are required.',
			);
		}

		const embeddings = (await this.getInputConnectionData(NodeConnectionTypes.AiEmbedding, 0)) as
			| IEmbeddingModel
			| undefined;
		const reranker = (await this.getInputConnectionData(NodeConnectionTypes.AiReranker, 0)) as
			| IRerankerModel
			| undefined;

		if (operation === 'hybridSearch' && !embeddings) {
			throw new NodeOperationError(
				this.getNode(),
				'Connect an Embeddings model to use Hybrid Search.',
			);
		}

		let client: CosmosClient;
		if (customEndpoint && customAccessToken) {
			client = new CosmosClient({
				endpoint: customEndpoint,
				aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
			});
		} else if (authenticationType === 'entraId') {
			const entraIdCredentials = await this.getCredentials('cosmosDbEntraIdApi');
			const endpoint = entraIdCredentials.endpoint as string;
			const oauthTokenData = entraIdCredentials.oauthTokenData as Record<string, unknown>;

			if (!oauthTokenData?.access_token) {
				throw new NodeOperationError(this.getNode(), 'No valid Entra ID access token found.');
			}

			client = new CosmosClient({
				endpoint,
				aadCredentials: new N8nCosmosTokenCredential(
					oauthTokenData.access_token as string,
					oauthTokenData.expires_at as string | undefined,
				),
			});
		} else {
			const credentials = await this.getCredentials('cosmosDbApi');
			client = new CosmosClient({
				endpoint: credentials.endpoint as string,
				key: credentials.key as string,
			});
		}

		const container = client.database(databaseName).container(containerName);
		const defaultSqlQuery = this.getNodeParameter(
			'sqlQuery',
			itemIndex,
			'SELECT * FROM c',
		) as string;
		const returnAll = this.getNodeParameter('returnAll', itemIndex, true) as boolean;
		const limit = this.getNodeParameter('limit', itemIndex, 50) as number;
		const defaultKeyword = this.getNodeParameter('keyword', itemIndex, '') as string;
		const defaultSearchQuery = this.getNodeParameter('searchQuery', itemIndex, '') as string;
		const vectorFieldName = this.getNodeParameter(
			'hybridVectorFieldName',
			itemIndex,
			'vector',
		) as string;
		const textFieldName = this.getNodeParameter('hybridTextFieldName', itemIndex, 'text') as string;
		const topK = this.getNodeParameter('topK', itemIndex, 10) as number;
		const partitionKeyField = this.getNodeParameter(
			'partitionKeyField',
			itemIndex,
			'category',
		) as string;
		const partitionKeyValue = this.getNodeParameter('partitionKeyValue', itemIndex, '') as string;
		const additionalFilters = this.getNodeParameter('additionalFilters', itemIndex, '') as string;
		const fieldsToReturn = this.getNodeParameter('fieldsToReturn', itemIndex, '') as string;

		const toolDescription =
			operation === 'hybridSearch'
				? `Search Cosmos DB container "${containerName}" in database "${databaseName}" using hybrid search. ` +
					`Input may be plain text or JSON like { "query": "search text", "keyword": "keywords", "topK": ${topK}, "partitionKeyValue": "" }.`
				: `Query Cosmos DB container "${containerName}" in database "${databaseName}" using SQL select. ` +
					`Input may be a SQL string or JSON like { "sql": "SELECT * FROM c", "rerankQuery": "optional ranking query" }.`;

		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { DynamicTool } = require('@langchain/core/tools') as {
			DynamicTool: new (config: {
				name: string;
				description: string;
				func: (input: string) => Promise<string>;
			}) => { name: string };
		};

		const tool = new DynamicTool({
			name: 'cosmos_db',
			description: toolDescription,
			func: async (input: string): Promise<string> => {
				try {
					let parsed: Record<string, unknown> = {};
					try {
						parsed = JSON.parse(input) as Record<string, unknown>;
					} catch {
						parsed = operation === 'hybridSearch' ? { query: input } : { sql: input };
					}

					const stripOutput = (doc: Record<string, unknown>): Record<string, unknown> => {
						let cleaned = doc;
						if (simplifyOutput) {
							cleaned = { ...cleaned };
							for (const field of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
								delete cleaned[field];
							}
						}

						if (excludeFields && fieldsToExclude) {
							cleaned = { ...cleaned };
							for (const field of fieldsToExclude
								.split(',')
								.map((item) => item.trim())
								.filter(Boolean)) {
								delete cleaned[field];
							}
						}

						return cleaned;
					};

					if (operation === 'hybridSearch') {
						const query =
							String(parsed.query ?? parsed.searchQuery ?? defaultSearchQuery ?? '').trim() ||
							input;
						const keyword = String(parsed.keyword ?? defaultKeyword ?? query).trim() || query;
						const effectiveTopK = Number(parsed.topK ?? topK);
						const effectivePkValue = String(
							parsed.partitionKeyValue ?? partitionKeyValue ?? '',
						).trim();
						const effectiveFilters = String(
							parsed.additionalFilters ?? additionalFilters ?? '',
						).trim();
						const effectiveFieldsToReturn = String(
							parsed.fieldsToReturn ?? fieldsToReturn ?? '',
						).trim();

						const embedding = await embeddings!.embedQuery(query);
						const embeddingLiteral = `[${embedding.join(',')}]`;
						const safeKeyword = keyword
							.replace(/\\/g, '\\\\')
							.replace(/"/g, '\\"')
							.trim()
							.split(/\s+/)
							.filter(Boolean)
							.map((word) => `'${word}'`)
							.join(',');

						const conditions: string[] = [];
						if (effectivePkValue) {
							conditions.push(`c.${partitionKeyField}='${effectivePkValue.replace(/'/g, "''")}'`);
						}
						if (effectiveFilters) {
							conditions.push(`(${effectiveFilters})`);
						}

						let selectClause = '*';
						if (effectiveFieldsToReturn) {
							selectClause = effectiveFieldsToReturn
								.split(',')
								.map((field) => {
									const trimmed = field.trim();
									return trimmed.startsWith('c.') || /\s+AS\s+/i.test(trimmed)
										? trimmed
										: `c.${trimmed}`;
								})
								.join(', ');
						}

						const whereClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
						const sql =
							`SELECT TOP ${effectiveTopK} ${selectClause} FROM c${whereClause} ` +
							`ORDER BY RANK RRF(FullTextScore(c.${textFieldName}, ${safeKeyword}), ` +
							`VectorDistance(c.${vectorFieldName}, ${embeddingLiteral}))`;

						const { resources } = await container.items.query(sql).fetchAll();
						if (!resources?.length) {
							return JSON.stringify({ message: 'No results found', operation, query });
						}

						const reranked = await rerankDocuments(
							resources as Array<Record<string, unknown>>,
							reranker,
							query,
							textFieldName,
						);

						return JSON.stringify(reranked.map(stripOutput));
					}

					const sql = String(parsed.sql ?? parsed.sqlQuery ?? defaultSqlQuery).trim();
					const rerankQuery = String(parsed.rerankQuery ?? parsed.query ?? '').trim();
					const { resources } = await container.items.query(sql).fetchAll();
					if (!resources?.length) {
						return JSON.stringify({ message: 'No results found', operation });
					}

					const limited = returnAll ? resources : resources.slice(0, limit);
					const reranked = await rerankDocuments(
						limited as Array<Record<string, unknown>>,
						reranker,
						rerankQuery,
					);

					return JSON.stringify(reranked.map(stripOutput));
				} catch (error) {
					return JSON.stringify({ error: (error as Error).message || String(error) });
				}
			},
		});

		return { response: tool };
	}

	async execute(): Promise<INodeExecutionData[][]> {
		return [[]];
	}
}
