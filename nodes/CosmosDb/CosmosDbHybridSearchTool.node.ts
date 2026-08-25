import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	IExecuteFunctions,
	SupplyData,
	INodeExecutionData,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IDataObject,
	FromAIArgument,
} from 'n8n-workflow';
import {
	NodeConnectionTypes,
	NodeOperationError,
	nodeNameToToolName,
	traverseNodeParametersWithParamNames,
} from 'n8n-workflow';
import { CosmosClient } from '@azure/cosmos';
import type { TokenCredential } from '@azure/core-auth';

interface ICosmosTokenData {
	accessToken: string;
	expiresAt?: string;
}

function parseTokenExpiryMs(tokenData?: Record<string, unknown>): number | undefined {
	if (!tokenData) {
		return undefined;
	}

	const rawExpiry = tokenData.expires_at ?? tokenData.expires_on ?? tokenData.expiry_date;
	if (rawExpiry === undefined || rawExpiry === null) {
		return undefined;
	}

	if (typeof rawExpiry === 'number' && Number.isFinite(rawExpiry)) {
		return rawExpiry > 1_000_000_000_000 ? rawExpiry : rawExpiry * 1000;
	}

	const numericExpiry = Number(rawExpiry);
	if (Number.isFinite(numericExpiry)) {
		return numericExpiry > 1_000_000_000_000 ? numericExpiry : numericExpiry * 1000;
	}

	const dateExpiry = Date.parse(String(rawExpiry));
	return Number.isNaN(dateExpiry) ? undefined : dateExpiry;
}

// ─── Embedding / Reranker interfaces ────────────────────────────────────────

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

// ─── Auth helpers (shared pattern from CosmosDbTool) ────────────────────────

class N8nCosmosTokenCredential implements TokenCredential {
	private readonly tokenSupplier: () => Promise<ICosmosTokenData>;

	constructor(
		accessTokenOrSupplier: string | (() => Promise<ICosmosTokenData> | ICosmosTokenData),
		private expiresAt?: string,
	) {
		if (typeof accessTokenOrSupplier === 'function') {
			this.tokenSupplier = async () => await accessTokenOrSupplier();
			return;
		}

		const normalizedAccessToken = accessTokenOrSupplier.replace(/^Bearer\s+/i, '');
		this.tokenSupplier = async () => ({
			accessToken: normalizedAccessToken,
			expiresAt: this.expiresAt,
		});
	}

	async getToken() {
		const { accessToken, expiresAt } = await this.tokenSupplier();
		const normalizedAccessToken = accessToken.replace(/^Bearer\s+/i, '');

		return {
			token: normalizedAccessToken,
			expiresOnTimestamp: expiresAt ? new Date(expiresAt).getTime() : Date.now() + 3600 * 1000,
		};
	}
}

function createEntraIdCosmosTokenCredential(
	context: {
		getCredentials(name: string): Promise<IDataObject>;
		getNode(): any;
		helpers?: {
			requestWithAuthentication?: (
				credentialsType: string,
				requestOptions: IDataObject,
				additionalData?: IDataObject,
			) => Promise<unknown>;
		};
	},
	missingTokenMessage = 'No valid Entra ID access token found.',
): N8nCosmosTokenCredential {
	return new N8nCosmosTokenCredential(async () => {
		let refreshedCredentials = await context.getCredentials('cosmosDbEntraIdApi');
		let refreshedTokenData = refreshedCredentials.oauthTokenData as Record<string, unknown>;

		const refreshBeforeExpirySeconds = Math.max(
			60,
			Number(refreshedCredentials.refreshBeforeExpirySeconds ?? 900) || 900,
		);
		const expiresOnMs = parseTokenExpiryMs(refreshedTokenData);
		const shouldRefresh =
			typeof expiresOnMs === 'number' &&
			expiresOnMs - Date.now() <= refreshBeforeExpirySeconds * 1000;

		if (shouldRefresh && context.helpers?.requestWithAuthentication) {
			const endpoint = String(refreshedCredentials.endpoint ?? '').trim();
			if (endpoint) {
				try {
					await context.helpers.requestWithAuthentication(
						'cosmosDbEntraIdApi',
						{
							method: 'GET',
							url: endpoint,
							timeout: 10000,
							json: false,
						},
						{},
					);
				} catch {
					// Ignore network/auth response errors here; refresh may still have been performed.
				}

				refreshedCredentials = await context.getCredentials('cosmosDbEntraIdApi');
				refreshedTokenData = refreshedCredentials.oauthTokenData as Record<string, unknown>;
			}
		}

		if (!refreshedTokenData?.access_token) {
			throw new NodeOperationError(context.getNode(), missingTokenMessage);
		}

		return {
			accessToken: refreshedTokenData.access_token as string,
			expiresAt: refreshedTokenData.expires_at as string | undefined,
		};
	});
}

type JwtClaims = Record<string, unknown>;

function decodeJwtClaims(token?: string): JwtClaims {
	if (!token) return {};
	const parts = token.split('.');
	if (parts.length < 2 || !parts[1]) return {};
	try {
		const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
		const payload = Buffer.from(padded, 'base64').toString('utf8');
		const parsed = JSON.parse(payload);
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function extractPreferredUserScopedName(
	oauthTokenData?: Record<string, unknown>,
): string | undefined {
	if (!oauthTokenData) return undefined;

	const directCandidate = [
		oauthTokenData.unique_name,
		oauthTokenData.preferred_username,
		oauthTokenData.email,
		oauthTokenData.upn,
	].find((v) => typeof v === 'string' && v.trim().length > 0) as string | undefined;

	const tokenClaims = [
		decodeJwtClaims(oauthTokenData.id_token as string | undefined),
		decodeJwtClaims(oauthTokenData.access_token as string | undefined),
	];

	const tokenCandidate = tokenClaims
		.map(
			(claims) =>
				[claims.unique_name, claims.preferred_username, claims.email, claims.upn].find(
					(v) => typeof v === 'string' && (v as string).trim().length > 0,
				) as string | undefined,
		)
		.find(Boolean);

	const identity = (directCandidate ?? tokenCandidate)?.trim().toLowerCase();
	return identity || undefined;
}

function prioritizeMatchingOption(
	options: INodePropertyOptions[],
	preferredValue?: string,
	label = 'Suggested',
): INodePropertyOptions[] {
	if (!preferredValue) return options;
	const idx = options.findIndex(
		(o) => typeof o.value === 'string' && o.value.toLowerCase() === preferredValue.toLowerCase(),
	);
	if (idx <= 0) {
		if (idx === 0)
			return [{ ...options[0], name: `${options[0].name} (${label})` }, ...options.slice(1)];
		return options;
	}
	const preferred = options[idx];
	return [
		{ ...preferred, name: `${preferred.name} (${label})` },
		...options.slice(0, idx),
		...options.slice(idx + 1),
	];
}

function getValueByPath(source: unknown, path: string): unknown {
	if (!path) return source;
	return path.split('.').reduce<unknown>((cur, seg) => {
		if (cur === null || cur === undefined) return undefined;
		if (Array.isArray(cur)) {
			const i = Number(seg);
			return Number.isInteger(i) ? cur[i] : undefined;
		}
		if (typeof cur === 'object') return (cur as Record<string, unknown>)[seg];
		return undefined;
	}, source);
}

function valueToRerankText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
}

function toTrimmedString(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value.trim();
	if (value === null || value === undefined) return fallback;
	return String(value).trim();
}

async function rerankDocuments<T extends Record<string, unknown>>(
	documents: T[],
	reranker: IRerankerModel | undefined,
	query: string,
	preferredTextPath = '',
): Promise<T[]> {
	if (!reranker || documents.length === 0 || !query.trim()) return documents;

	const rerankInput: IRerankDocument[] = documents.map((doc, i) => {
		const preferred = preferredTextPath ? getValueByPath(doc, preferredTextPath) : undefined;
		return { pageContent: valueToRerankText(preferred ?? doc), metadata: { documentIndex: i } };
	});

	const reranked = await reranker.compressDocuments(rerankInput, query);
	const ordered: T[] = [];
	const used = new Set<number>();

	for (const doc of reranked) {
		const i = Number(doc.metadata.documentIndex);
		if (!Number.isInteger(i) || used.has(i)) continue;
		const original = documents[i];
		if (!original) continue;
		used.add(i);
		ordered.push(original);
	}
	for (const [i, doc] of documents.entries()) {
		if (!used.has(i)) ordered.push(doc);
	}
	return ordered;
}

// ─── Node ────────────────────────────────────────────────────────────────────

export class CosmosDbHybridSearchTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Cosmos DB Hybrid Search Tool',
		name: 'cosmosDbHybridSearchTool',
		icon: { light: 'file:database.svg', dark: 'file:lightDatabase.svg' },
		group: ['transform'],
		version: 1,
		description: 'Hybrid vector + full-text search on Azure Cosmos DB for AI Agent workflows',
		defaults: { name: 'Cosmos DB Hybrid Search' },
		codex: {
			categories: ['AI'],
			subcategories: {
				AI: ['Tools', 'Root Nodes'],
				Tools: ['Other Tools'],
			},
		},
		// Dynamic inputs — show Reranker only when useReranker toggle is enabled
		inputs:
			`={{ $parameter["useReranker"] ? [{ displayName: 'Embeddings', type: '${NodeConnectionTypes.AiEmbedding}', required: true, maxConnections: 1 }, { displayName: 'Reranker', type: '${NodeConnectionTypes.AiReranker}', required: false, maxConnections: 1 }] : [{ displayName: 'Embeddings', type: '${NodeConnectionTypes.AiEmbedding}', required: true, maxConnections: 1 }] }}` as unknown as INodeTypeDescription['inputs'],
		// Only AiTool output — node lives entirely on the AI tool bus
		outputs: [NodeConnectionTypes.AiTool],
		credentials: [
			{
				name: 'cosmosDbApi',
				required: true,
				displayOptions: { show: { authenticationType: ['masterKey'] } },
			},
			{
				name: 'cosmosDbEntraIdApi',
				required: true,
				displayOptions: { show: { authenticationType: ['entraId'] } },
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
				description: 'The authentication method to use for connecting to Cosmos DB',
			},
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'e.g. Search the research paper database for relevant documents',
				description:
					'Tell the AI agent what this tool is for. If left empty an automatic description is generated.',
			},
			{
				displayName: 'Database Name or ID',
				name: 'databaseName',
				type: 'options',
				typeOptions: {
					loadOptionsDependsOn: [
						'authenticationType',
						'useDevOverride',
						'customEndpoint',
						'customAccessToken',
					],
					loadOptionsMethod: 'getDatabases',
				},
				default: '',
				placeholder: 'Select a database...',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Container Name or ID',
				name: 'containerName',
				type: 'options',
				typeOptions: {
					loadOptionsDependsOn: [
						'databaseName',
						'authenticationType',
						'useDevOverride',
						'customEndpoint',
						'customAccessToken',
					],
					loadOptionsMethod: 'getContainers',
				},
				default: '',
				placeholder: 'Select a container...',
				required: true,
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Vector Field Name',
				name: 'vectorFieldName',
				type: 'string',
				default: 'vector',
				required: true,
				description: 'The document field that stores the vector embedding',
			},
			{
				displayName: 'Full Text Field Name',
				name: 'textFieldName',
				type: 'string',
				default: 'text',
				required: true,
				description: 'The document field used for full-text RRF scoring',
			},
			{
				displayName: 'Vector Query',
				name: 'vectorQuery',
				type: 'string',
				default: '',
				placeholder: 'e.g. accommodation application procedure HKU Cedars',
				description:
					'Semantic vector query used for embeddings. Click Determine by AI model only when the AI Agent should provide this value.',
			},
			{
				displayName: 'Full Text Query',
				name: 'fullTextQuery',
				type: 'string',
				default: '',
				placeholder: 'e.g. accommodation application procedure',
				description:
					'Keyword query used for full-text ranking. Click Determine by AI model only when the AI Agent should provide this value.',
			},
			{
				displayName: 'Top K',
				name: 'topK',
				type: 'number',
				default: 10,
				typeOptions: { minValue: 1, maxValue: 1000 },
				description: 'Number of top results to retrieve',
				hint: 'AI-provided topK is used only when Top K is set to Determine by AI model.',
			},
			{
				displayName: 'Use Reranker',
				name: 'useReranker',
				type: 'boolean',
				default: false,
				description: 'Whether to enable the Reranker input for re-ranking results after retrieval',
			},
			{
				displayName: 'Fields to Exclude',
				name: 'fieldsToExclude',
				type: 'string',
				default: 'vector,text',
				placeholder: 'vector,text,rawContent',
				description: 'Comma-separated fields to remove from output',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Additional SQL Filters',
						name: 'additionalFilters',
						type: 'string',
						default: '',
						typeOptions: { rows: 2 },
						placeholder: 'c.published = true AND c.year > 2020',
						description: 'Optional SQL conditions appended to the query (no WHERE keyword)',
					},
					{
						displayName: 'Custom Access Token',
						name: 'customAccessToken',
						type: 'string',
						typeOptions: { password: true },
						default: '',
						description: 'Bearer token to use with the custom endpoint override',
					},
					{
						displayName: 'Custom Endpoint',
						name: 'customEndpoint',
						type: 'string',
						default: '',
						placeholder: 'https://your-account.documents.azure.com:443/',
						description: 'Cosmos DB account endpoint URL for the dev override',
					},
					{
						displayName: 'Fields to Return',
						name: 'fieldsToReturn',
						type: 'string',
						default: '',
						placeholder: 'ID, title, summary',
						description: 'Comma-separated fields to return. Leave empty to return full documents.',
					},
					{
						displayName: 'Include Debug Info',
						name: 'includeDebugInfo',
						type: 'boolean',
						default: false,
						description:
							'Whether to include the generated SQL and embedding diagnostics in the response',
					},
					{
						displayName: 'Partition Key Field',
						name: 'partitionKeyField',
						type: 'string',
						default: 'category',
						description: 'The partition key field name for optional filtering',
					},
					{
						displayName: 'Partition Key Value',
						name: 'partitionKeyValue',
						type: 'string',
						default: '',
						description: 'Optional partition key value to filter results',
					},
					{
						displayName: 'Simplify Output',
						name: 'simplifyOutput',
						type: 'boolean',
						default: true,
						description: 'Whether to strip Cosmos DB internal metadata fields (_rid, _self, etc.)',
					},
					{
						displayName: 'Use Dev Override (Custom Endpoint + Token)',
						name: 'useDevOverride',
						type: 'boolean',
						default: false,
						description: 'Whether to override credentials with a custom endpoint and access token',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const authenticationType = this.getNodeParameter('authenticationType', 0) as string;
				const options = this.getNodeParameter('options', 0, {}) as Record<string, unknown>;
				const customEndpoint = ((options.customEndpoint as string) || '').trim();
				const customAccessToken = ((options.customAccessToken as string) || '').trim();
				let client: CosmosClient;
				let preferredUserScopedName: string | undefined;

				if (customEndpoint && customAccessToken) {
					preferredUserScopedName = extractPreferredUserScopedName({
						access_token: customAccessToken,
					});
					client = new CosmosClient({
						endpoint: customEndpoint,
						aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
					});
				} else if (authenticationType === 'entraId') {
					const creds = await this.getCredentials('cosmosDbEntraIdApi');
					const oauthTokenData = creds.oauthTokenData as Record<string, unknown>;
					preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
					client = new CosmosClient({
						endpoint: creds.endpoint as string,
						aadCredentials: createEntraIdCosmosTokenCredential(this),
					});
				} else {
					const creds = await this.getCredentials('cosmosDbApi');
					client = new CosmosClient({
						endpoint: creds.endpoint as string,
						key: creds.key as string,
					});
				}

				try {
					const { resources } = await client.databases.readAll().fetchAll();
					const opts = resources.map((db: { id: string }) => ({ name: db.id, value: db.id }));
					return prioritizeMatchingOption(opts, preferredUserScopedName);
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load databases: ${(error as Error).message}`,
					);
				}
			},

			async getContainers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const authenticationType = this.getNodeParameter('authenticationType', 0) as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;
				if (!databaseName) return [];

				const options = this.getNodeParameter('options', 0, {}) as Record<string, unknown>;
				const customEndpoint = ((options.customEndpoint as string) || '').trim();
				const customAccessToken = ((options.customAccessToken as string) || '').trim();
				let client: CosmosClient;
				let preferredUserScopedName: string | undefined;

				if (customEndpoint && customAccessToken) {
					preferredUserScopedName = extractPreferredUserScopedName({
						access_token: customAccessToken,
					});
					client = new CosmosClient({
						endpoint: customEndpoint,
						aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
					});
				} else if (authenticationType === 'entraId') {
					const creds = await this.getCredentials('cosmosDbEntraIdApi');
					const oauthTokenData = creds.oauthTokenData as Record<string, unknown>;
					preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
					client = new CosmosClient({
						endpoint: creds.endpoint as string,
						aadCredentials: createEntraIdCosmosTokenCredential(this),
					});
				} else {
					const creds = await this.getCredentials('cosmosDbApi');
					client = new CosmosClient({
						endpoint: creds.endpoint as string,
						key: creds.key as string,
					});
				}

				try {
					const { resources } = await client.database(databaseName).containers.readAll().fetchAll();
					const opts = resources.map((c: { id: string }) => ({ name: c.id, value: c.id }));
					return prioritizeMatchingOption(opts, preferredUserScopedName);
				} catch (error) {
					throw new NodeOperationError(
						this.getNode(),
						`Failed to load containers: ${(error as Error).message}`,
					);
				}
			},
		},
	};

	/**
	 * Called by n8n's AI pipeline to register this node as a tool on the agent's tool bus.
	 * Follows the same pattern as native vector store nodes (Pinecone, Supabase, etc.):
	 * - embeddings captured at setup time from the AiEmbedding input
	 * - func(input) receives the agent's plain-text query, embeds it, runs hybrid search
	 * - addInputData / addOutputData track the execution in n8n's data flow
	 */
	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const authenticationType = this.getNodeParameter(
			'authenticationType',
			itemIndex,
			'masterKey',
		) as string;
		const databaseName = toTrimmedString(this.getNodeParameter('databaseName', itemIndex, ''), '');
		const containerName = toTrimmedString(
			this.getNodeParameter('containerName', itemIndex, ''),
			'',
		);
		const vectorFieldName = toTrimmedString(
			this.getNodeParameter('vectorFieldName', itemIndex, 'vector'),
			'',
		);
		const textFieldName = toTrimmedString(
			this.getNodeParameter('textFieldName', itemIndex, 'text'),
			'',
		);
		const nodeVectorQuery = toTrimmedString(
			this.getNodeParameter('vectorQuery', itemIndex, ''),
			'',
		);
		const nodeFullTextQuery = toTrimmedString(
			this.getNodeParameter('fullTextQuery', itemIndex, ''),
			'',
		);
		const topK = this.getNodeParameter('topK', itemIndex, 10) as number;
		const manualToolDescription = toTrimmedString(
			this.getNodeParameter('toolDescription', itemIndex, ''),
			'',
		);
		const options = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;

		const partitionKeyField = ((options.partitionKeyField as string) || 'category').trim();
		const partitionKeyValue = ((options.partitionKeyValue as string) || '').trim();
		const additionalFilters = ((options.additionalFilters as string) || '').trim();
		const fieldsToReturn = ((options.fieldsToReturn as string) || '').trim();
		const simplifyOutput = options.simplifyOutput !== false;
		const excludeFieldsStr =
			(this.getNodeParameter('fieldsToExclude', itemIndex, 'vector,text') as string).trim() ||
			((options.excludeFields as string) || '').trim();
		const includeDebugInfo = options.includeDebugInfo === true;
		const customEndpoint = ((options.customEndpoint as string) || '').trim();
		const customAccessToken = ((options.customAccessToken as string) || '').trim();
		const useReranker = this.getNodeParameter('useReranker', itemIndex, false) as boolean;

		if (!databaseName || !containerName) {
			throw new NodeOperationError(
				this.getNode(),
				'Database Name and Container Name are required.',
			);
		}

		// Capture embeddings and reranker at setup time — same as native vector store nodes
		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			0,
		)) as IEmbeddingModel;

		const reranker = useReranker
			? ((await this.getInputConnectionData(NodeConnectionTypes.AiReranker, 0)) as
					| IRerankerModel
					| undefined)
			: undefined;

		if (!embeddings) {
			throw new NodeOperationError(
				this.getNode(),
				'Connect an Embeddings model to use Hybrid Search.',
			);
		}

		// Build the Cosmos DB client
		let client: CosmosClient;
		if (customEndpoint && customAccessToken) {
			client = new CosmosClient({
				endpoint: customEndpoint,
				aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
			});
		} else if (authenticationType === 'entraId') {
			const creds = await this.getCredentials('cosmosDbEntraIdApi');
			const oauthTokenData = creds.oauthTokenData as Record<string, unknown>;
			if (!oauthTokenData?.access_token) {
				throw new NodeOperationError(this.getNode(), 'No valid Entra ID access token found.');
			}
			client = new CosmosClient({
				endpoint: creds.endpoint as string,
				aadCredentials: createEntraIdCosmosTokenCredential(this),
			});
		} else {
			const creds = await this.getCredentials('cosmosDbApi');
			client = new CosmosClient({ endpoint: creds.endpoint as string, key: creds.key as string });
		}

		const container = client.database(databaseName).container(containerName);

		// Tool name derived from the node's display name (native nodes v1.3+ pattern)
		const toolName = nodeNameToToolName(this.getNode());

		const fromAiArguments = new Map<string, FromAIArgument>();
		traverseNodeParametersWithParamNames(this.getNode().parameters, fromAiArguments);
		const defaultVectorQueryDescription = 'semantic query describing user intent';
		const defaultFullTextQueryDescription = 'keyword query for full-text search (max 5 words)';
		const getFromAiDescription = (
			parameterNames: string | string[],
			fallback: string,
			suffix?: string,
		) => {
			const names = Array.isArray(parameterNames) ? parameterNames : [parameterNames];
			const description = names
				.map((parameterName) => fromAiArguments.get(parameterName)?.description?.trim())
				.find(Boolean);

			if (!description) return fallback;

			return suffix ? `${description}\n\n${suffix}` : description;
		};
		const fromAiDescriptionLines = Array.from(fromAiArguments.entries())
			.map(([parameterName, argument]) => {
				const description = argument.description?.trim();
				return description ? `- ${parameterName}: ${description}` : undefined;
			})
			.filter(Boolean)
			.join('\n');
		const hasFromAiParameter = (parameterName: string): boolean => {
			const argument = fromAiArguments.get(parameterName);
			return Boolean(argument?.key?.trim());
		};

		const baseToolDescription =
			manualToolDescription ||
			`Search Azure Cosmos DB container "${containerName}" in database "${databaseName}" ` +
				`using hybrid full-text and vector search. ` +
				`Use the values configured on this node. Only provide tool input fields that are set to Determine by AI model. ` +
				`Returns up to ${topK} results ranked by combined semantic and keyword relevance.`;
		const toolDescription = fromAiDescriptionLines
			? `${baseToolDescription}\n\nConfigured From AI field descriptions:\n${fromAiDescriptionLines}`
			: baseToolDescription;

		const canOverrideVectorQueryFromAi = hasFromAiParameter('vectorQuery');
		const canOverrideFullTextQueryFromAi = hasFromAiParameter('fullTextQuery');
		const canOverrideTopKFromAi = hasFromAiParameter('topK');
		const canOverridePartitionKeyFieldFromAi =
			hasFromAiParameter('partitionKeyField') || hasFromAiParameter('options.partitionKeyField');
		const canOverridePartitionKeyValueFromAi =
			hasFromAiParameter('partitionKeyValue') || hasFromAiParameter('options.partitionKeyValue');
		const canOverrideAdditionalFiltersFromAi =
			hasFromAiParameter('additionalFilters') || hasFromAiParameter('options.additionalFilters');
		const canOverrideFieldsToReturnFromAi =
			hasFromAiParameter('fieldsToReturn') || hasFromAiParameter('options.fieldsToReturn');

		const schemaProperties: Record<string, unknown> = {};
		const schemaRequired: string[] = [];

		if (canOverrideVectorQueryFromAi) {
			schemaProperties.vectorQuery = {
				type: 'string',
				description: getFromAiDescription('vectorQuery', defaultVectorQueryDescription),
			};
			schemaRequired.push('vectorQuery');
		}

		if (canOverrideFullTextQueryFromAi) {
			schemaProperties.fullTextQuery = {
				type: 'string',
				description: getFromAiDescription('fullTextQuery', defaultFullTextQueryDescription),
			};
			schemaRequired.push('fullTextQuery');
		}

		if (canOverrideTopKFromAi) {
			schemaProperties.topK = {
				type: 'number',
				description: getFromAiDescription('topK', 'Maximum number of results to return.'),
			};
		}

		if (canOverridePartitionKeyFieldFromAi) {
			schemaProperties.partitionKeyField = {
				type: 'string',
				description: getFromAiDescription(
					['options.partitionKeyField', 'partitionKeyField'],
					'Optional partition key field name used for filtering.',
				),
			};
		}

		if (canOverridePartitionKeyValueFromAi) {
			schemaProperties.partitionKeyValue = {
				type: 'string',
				description: getFromAiDescription(
					['options.partitionKeyValue', 'partitionKeyValue'],
					'Optional partition key value to filter results.',
				),
			};
		}

		if (canOverrideAdditionalFiltersFromAi) {
			schemaProperties.additionalFilters = {
				type: 'string',
				description: getFromAiDescription(
					['options.additionalFilters', 'additionalFilters'],
					'Optional Cosmos DB SQL filter conditions without the WHERE keyword.',
				),
			};
		}

		if (canOverrideFieldsToReturnFromAi) {
			schemaProperties.fieldsToReturn = {
				type: 'string',
				description: getFromAiDescription(
					['options.fieldsToReturn', 'fieldsToReturn'],
					'Optional comma-separated fields to return instead of full documents.',
				),
			};
		}

		// Helper to strip unwanted fields from output documents
		const stripOutput = (doc: Record<string, unknown>): Record<string, unknown> => {
			let cleaned = { ...doc };
			if (simplifyOutput) {
				for (const field of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
					delete cleaned[field];
				}
			}
			if (excludeFieldsStr) {
				for (const field of excludeFieldsStr
					.split(',')
					.map((f) => f.trim())
					.filter(Boolean)) {
					delete cleaned[field];
				}
			}
			return cleaned;
		};

		// Capture context for addInputData / addOutputData (mirrors logWrapper behaviour)
		const context = this;

		const { DynamicStructuredTool } = require('@langchain/core/tools') as {
			DynamicStructuredTool: new (config: {
				name: string;
				description: string;
				schema: unknown;
				func: (input: {
					vector: string;
					fullText: string;
					topK?: number;
					partitionKeyField?: string;
					partitionKeyValue?: string;
					additionalFilters?: string;
					fieldsToReturn?: string;
				}) => Promise<string>;
			}) => object;
		};

		const tool = new DynamicStructuredTool({
			name: toolName,
			description: toolDescription,
			// Plain JSON Schema — avoids cross-module Zod instanceof mismatch
			schema: {
				type: 'object',
				properties: schemaProperties,
				required: schemaRequired,
				additionalProperties: false,
			},
			func: async ({
				vectorQuery,
				fullTextQuery,
				vector,
				fullText,
				topK: inputTopK,
				partitionKeyField: inputPartitionKeyField,
				partitionKeyValue: inputPartitionKeyValue,
				additionalFilters: inputAdditionalFilters,
				fieldsToReturn: inputFieldsToReturn,
			}: {
				vectorQuery?: string;
				fullTextQuery?: string;
				vector?: string;
				fullText?: string;
				topK?: number;
				partitionKeyField?: string;
				partitionKeyValue?: string;
				additionalFilters?: string;
				fieldsToReturn?: string;
			}): Promise<string> => {
				const effectiveVectorQuery = (
					canOverrideVectorQueryFromAi
						? String(vectorQuery ?? vector ?? nodeVectorQuery)
						: nodeVectorQuery
				).trim();
				const candidateFullTextQuery = (
					canOverrideFullTextQueryFromAi
						? String(fullTextQuery ?? fullText ?? nodeFullTextQuery ?? effectiveVectorQuery)
						: String(nodeFullTextQuery || effectiveVectorQuery)
				).trim();
				const effectiveFullTextQuery = candidateFullTextQuery || effectiveVectorQuery;
				const effectiveTopK =
					canOverrideTopKFromAi && Number.isFinite(Number(inputTopK)) && Number(inputTopK) > 0
						? Number(inputTopK)
						: topK;
				const effectivePartitionKeyField = String(
					canOverridePartitionKeyFieldFromAi
						? (inputPartitionKeyField ?? partitionKeyField)
						: partitionKeyField,
				).trim();
				const effectivePartitionKeyValue = String(
					canOverridePartitionKeyValueFromAi
						? (inputPartitionKeyValue ?? partitionKeyValue)
						: partitionKeyValue,
				).trim();
				const effectiveAdditionalFilters = String(
					canOverrideAdditionalFiltersFromAi
						? (inputAdditionalFilters ?? additionalFilters)
						: additionalFilters,
				).trim();
				const effectiveFieldsToReturn = String(
					canOverrideFieldsToReturnFromAi
						? (inputFieldsToReturn ?? fieldsToReturn)
						: fieldsToReturn,
				).trim();
				// Track tool invocation input in n8n execution data
				const { index } = context.addInputData(NodeConnectionTypes.AiTool, [
					[
						{
							json: {
								vectorQuery: effectiveVectorQuery,
								fullTextQuery: effectiveFullTextQuery,
								topK: effectiveTopK,
								partitionKeyField: effectivePartitionKeyField,
								partitionKeyValue: effectivePartitionKeyValue,
								additionalFilters: effectiveAdditionalFilters,
								fieldsToReturn: effectiveFieldsToReturn,
							},
						},
					],
				]);

				try {
					if (!effectiveVectorQuery && !effectiveFullTextQuery) {
						const errorMessage =
							'Provide Vector Query and/or Full Text Query, or set one of them to Determine by AI model.';
						context.addOutputData(NodeConnectionTypes.AiTool, index, [
							[{ json: { error: errorMessage } }],
						]);
						return JSON.stringify({ error: errorMessage });
					}

					// Embed the semantic query; use fullText keywords for full-text scoring
					const embedding = await embeddings.embedQuery(effectiveVectorQuery);
					const embeddingLiteral = `[${embedding.join(',')}]`;

					const safeKeyword = effectiveFullTextQuery
						.trim()
						.split(/\s+/)
						.filter(Boolean)
						.map((word) => `'${word.replace(/'/g, "''")}'`)
						.join(',');

					const conditions: string[] = [];
					if (effectivePartitionKeyValue) {
						conditions.push(
							`c.${effectivePartitionKeyField}='${effectivePartitionKeyValue.replace(/'/g, "''")}'`,
						);
					}
					if (effectiveAdditionalFilters) {
						conditions.push(`(${effectiveAdditionalFilters})`);
					}

					let selectClause = '*';
					if (effectiveFieldsToReturn) {
						selectClause = effectiveFieldsToReturn
							.split(',')
							.map((f) => {
								const t = f.trim();
								return t.startsWith('c.') || /\s+AS\s+/i.test(t) ? t : `c.${t}`;
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
						const noResult = JSON.stringify(
							includeDebugInfo
								? {
										message: 'No results found',
										vectorQuery: effectiveVectorQuery,
										fullTextQuery: effectiveFullTextQuery,
										sql,
									}
								: {
										message: 'No results found',
										vectorQuery: effectiveVectorQuery,
										fullTextQuery: effectiveFullTextQuery,
									},
						);
						context.addOutputData(NodeConnectionTypes.AiTool, index, [
							[{ json: { response: noResult } }],
						]);
						return noResult;
					}

					const reranked = await rerankDocuments(
						resources as Array<Record<string, unknown>>,
						reranker,
						effectiveVectorQuery,
						textFieldName,
					);

					const cleaned = reranked.map(stripOutput);
					const response = JSON.stringify(
						includeDebugInfo
							? {
									results: cleaned,
									debug: {
										vectorQuery: effectiveVectorQuery,
										fullTextQuery: effectiveFullTextQuery,
										sql,
										embeddingDimensions: embedding.length,
										resultCount: cleaned.length,
									},
								}
							: cleaned,
					);

					// Track output in n8n execution data
					context.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { response } }]]);
					return response;
				} catch (error) {
					const message = (error as Error).message || String(error);
					context.addOutputData(NodeConnectionTypes.AiTool, index, [
						[{ json: { error: message } }],
					]);
					return JSON.stringify({ error: message });
				}
			},
		});

		return { response: tool };
	}

	/**
	 * Called by n8n's engine when the AI agent invokes this tool via EngineRequest.
	 * The query arrives as getInputData()[0].json.input (set by prepareRequestedNodesForExecution).
	 * Output is stored as data.ai_tool[0] (via node.rewireOutputLogTo='ai_tool'), which
	 * buildSteps() reads to build the tool observation sent back to the LLM.
	 */
	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const inputJson = items[0]?.json ?? {};
		const fromAiArguments = new Map<string, FromAIArgument>();
		traverseNodeParametersWithParamNames(this.getNode().parameters, fromAiArguments);
		const hasFromAiParameter = (parameterName: string): boolean => {
			const argument = fromAiArguments.get(parameterName);
			return Boolean(argument?.key?.trim());
		};

		const itemIndex = 0;
		const nodeVectorQuery = toTrimmedString(
			this.getNodeParameter('vectorQuery', itemIndex, ''),
			'',
		);
		const nodeFullTextQuery = toTrimmedString(
			this.getNodeParameter('fullTextQuery', itemIndex, ''),
			'',
		);

		// Support split-field schemas and legacy { input }
		const legacyInput = toTrimmedString(inputJson.input, '');
		const rawInputVectorQuery = toTrimmedString(
			inputJson.vectorQuery ?? inputJson.vector ?? legacyInput,
			'',
		);
		const canOverrideVectorQueryFromAi = hasFromAiParameter('vectorQuery');
		const canOverrideFullTextQueryFromAi = hasFromAiParameter('fullTextQuery');
		const vectorQuery = toTrimmedString(
			canOverrideVectorQueryFromAi ? rawInputVectorQuery || nodeVectorQuery : nodeVectorQuery,
			'',
		);
		const fullTextQuery = toTrimmedString(
			canOverrideFullTextQueryFromAi
				? (inputJson.fullTextQuery ??
						inputJson.fullText ??
						legacyInput ??
						nodeFullTextQuery ??
						vectorQuery)
				: nodeFullTextQuery || vectorQuery,
			'',
		);

		if (!vectorQuery && !fullTextQuery) {
			// Called during setup / configuration phase — no real query yet
			return [[{ json: { output: 'No query provided' } }]];
		}

		const authenticationType = this.getNodeParameter(
			'authenticationType',
			itemIndex,
			'masterKey',
		) as string;
		const databaseName = toTrimmedString(this.getNodeParameter('databaseName', itemIndex, ''), '');
		const containerName = toTrimmedString(
			this.getNodeParameter('containerName', itemIndex, ''),
			'',
		);
		const vectorFieldName = toTrimmedString(
			this.getNodeParameter('vectorFieldName', itemIndex, 'vector'),
			'',
		);
		const textFieldName = toTrimmedString(
			this.getNodeParameter('textFieldName', itemIndex, 'text'),
			'',
		);
		const topK = this.getNodeParameter('topK', itemIndex, 10) as number;
		const options = this.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;

		const partitionKeyField = ((options.partitionKeyField as string) || 'category').trim();
		const partitionKeyValue = ((options.partitionKeyValue as string) || '').trim();
		const additionalFilters = ((options.additionalFilters as string) || '').trim();
		const fieldsToReturn = ((options.fieldsToReturn as string) || '').trim();
		const canOverrideTopKFromAi = hasFromAiParameter('topK');
		const canOverridePartitionKeyFieldFromAi =
			hasFromAiParameter('partitionKeyField') || hasFromAiParameter('options.partitionKeyField');
		const canOverridePartitionKeyValueFromAi =
			hasFromAiParameter('partitionKeyValue') || hasFromAiParameter('options.partitionKeyValue');
		const canOverrideAdditionalFiltersFromAi =
			hasFromAiParameter('additionalFilters') || hasFromAiParameter('options.additionalFilters');
		const canOverrideFieldsToReturnFromAi =
			hasFromAiParameter('fieldsToReturn') || hasFromAiParameter('options.fieldsToReturn');
		const inputTopK = Number(inputJson.topK);
		const effectiveTopK =
			canOverrideTopKFromAi && Number.isFinite(inputTopK) && inputTopK > 0 ? inputTopK : topK;
		const effectivePartitionKeyField = String(
			canOverridePartitionKeyFieldFromAi
				? (inputJson.partitionKeyField ?? partitionKeyField)
				: partitionKeyField,
		).trim();
		const effectivePartitionKeyValue = String(
			canOverridePartitionKeyValueFromAi
				? (inputJson.partitionKeyValue ?? partitionKeyValue)
				: partitionKeyValue,
		).trim();
		const effectiveAdditionalFilters = String(
			canOverrideAdditionalFiltersFromAi
				? (inputJson.additionalFilters ?? additionalFilters)
				: additionalFilters,
		).trim();
		const effectiveFieldsToReturn = String(
			canOverrideFieldsToReturnFromAi
				? (inputJson.fieldsToReturn ?? fieldsToReturn)
				: fieldsToReturn,
		).trim();
		const simplifyOutput = options.simplifyOutput !== false;
		const excludeFieldsStr =
			(this.getNodeParameter('fieldsToExclude', itemIndex, 'vector,text') as string).trim() ||
			((options.excludeFields as string) || '').trim();
		const includeDebugInfo = options.includeDebugInfo === true;
		const customEndpoint = ((options.customEndpoint as string) || '').trim();
		const customAccessToken = ((options.customAccessToken as string) || '').trim();
		const useReranker = this.getNodeParameter('useReranker', itemIndex, false) as boolean;

		if (!databaseName || !containerName) {
			return [[{ json: { output: 'Database Name and Container Name are required.' } }]];
		}

		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			0,
		)) as IEmbeddingModel;

		if (!embeddings) {
			return [[{ json: { output: 'No Embeddings model connected.' } }]];
		}

		const reranker = useReranker
			? ((await this.getInputConnectionData(NodeConnectionTypes.AiReranker, 0)) as
					| IRerankerModel
					| undefined)
			: undefined;

		let client: CosmosClient;
		if (customEndpoint && customAccessToken) {
			client = new CosmosClient({
				endpoint: customEndpoint,
				aadCredentials: new N8nCosmosTokenCredential(customAccessToken),
			});
		} else if (authenticationType === 'entraId') {
			const creds = await this.getCredentials('cosmosDbEntraIdApi');
			const oauthTokenData = creds.oauthTokenData as Record<string, unknown>;
			if (!oauthTokenData?.access_token) {
				return [[{ json: { output: 'No valid Entra ID access token found.' } }]];
			}
			client = new CosmosClient({
				endpoint: creds.endpoint as string,
				aadCredentials: createEntraIdCosmosTokenCredential(this),
			});
		} else {
			const creds = await this.getCredentials('cosmosDbApi');
			client = new CosmosClient({ endpoint: creds.endpoint as string, key: creds.key as string });
		}

		const container = client.database(databaseName).container(containerName);

		const stripOutput = (doc: Record<string, unknown>): Record<string, unknown> => {
			const cleaned = { ...doc };
			if (simplifyOutput) {
				for (const field of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
					delete cleaned[field];
				}
			}
			if (excludeFieldsStr) {
				for (const field of excludeFieldsStr
					.split(',')
					.map((f) => f.trim())
					.filter(Boolean)) {
					delete cleaned[field];
				}
			}
			return cleaned;
		};

		try {
			const embedding = await embeddings.embedQuery(vectorQuery);
			const embeddingLiteral = `[${embedding.join(',')}]`;

			const safeKeyword = fullTextQuery
				.trim()
				.split(/\s+/)
				.filter(Boolean)
				.map((word) => `'${word}'`)
				.join(',');

			const conditions: string[] = [];
			if (effectivePartitionKeyValue) {
				conditions.push(
					`c.${effectivePartitionKeyField}='${effectivePartitionKeyValue.replace(/'/g, "''")}'`,
				);
			}
			if (effectiveAdditionalFilters) {
				conditions.push(`(${effectiveAdditionalFilters})`);
			}

			let selectClause = '*';
			if (effectiveFieldsToReturn) {
				selectClause = effectiveFieldsToReturn
					.split(',')
					.map((f) => {
						const t = f.trim();
						return t.startsWith('c.') || /\s+AS\s+/i.test(t) ? t : `c.${t}`;
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
				const noResult = includeDebugInfo
					? { message: 'No results found', vectorQuery, fullTextQuery, sql }
					: { message: 'No results found', vectorQuery, fullTextQuery };
				return [[{ json: noResult }]];
			}

			const reranked = await rerankDocuments(
				resources as Array<Record<string, unknown>>,
				reranker,
				vectorQuery,
				textFieldName,
			);

			const cleaned = reranked.map(stripOutput);

			if (includeDebugInfo) {
				return [
					cleaned.map((doc, i) => ({
						json: {
							...doc,
							_debug:
								i === 0
									? {
											vectorQuery,
											fullTextQuery,
											sql,
											embeddingDimensions: embedding.length,
											resultCount: cleaned.length,
										}
									: undefined,
						} as IDataObject,
					})),
				];
			}

			return [cleaned.map((doc) => ({ json: doc as IDataObject }))];
		} catch (error) {
			const message = (error as Error).message || String(error);
			return [[{ json: { error: message } }]];
		}
	}
}
