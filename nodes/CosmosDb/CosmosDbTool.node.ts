import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	IExecuteFunctions,
	SupplyData,
	INodeExecutionData,
	ILoadOptionsFunctions,
	INodePropertyOptions,
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
	if (!token) {
		return {};
	}

	const tokenParts = token.split('.');
	if (tokenParts.length < 2 || !tokenParts[1]) {
		return {};
	}

	try {
		const normalizedPayload = tokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
		const paddedPayload = normalizedPayload.padEnd(
			Math.ceil(normalizedPayload.length / 4) * 4,
			'=',
		);
		const payload = Buffer.from(paddedPayload, 'base64').toString('utf8');
		const parsedPayload = JSON.parse(payload);

		return typeof parsedPayload === 'object' && parsedPayload !== null ? parsedPayload : {};
	} catch {
		return {};
	}
}

function extractPreferredUserScopedName(
	oauthTokenData?: Record<string, unknown>,
): string | undefined {
	if (!oauthTokenData) {
		return undefined;
	}

	const directCandidate = [
		oauthTokenData.unique_name,
		oauthTokenData.preferred_username,
		oauthTokenData.email,
		oauthTokenData.upn,
	].find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;

	const tokenClaims = [
		decodeJwtClaims(oauthTokenData.id_token as string | undefined),
		decodeJwtClaims(oauthTokenData.access_token as string | undefined),
	];

	const tokenCandidate = tokenClaims
		.map(
			(claims) =>
				[claims.unique_name, claims.preferred_username, claims.email, claims.upn].find(
					(value) => typeof value === 'string' && value.trim().length > 0,
				) as string | undefined,
		)
		.find((value) => Boolean(value));

	const preferredIdentity = directCandidate ?? tokenCandidate;
	if (!preferredIdentity) {
		return undefined;
	}

	const normalizedIdentity = preferredIdentity.trim().toLowerCase();
	if (!normalizedIdentity) {
		return undefined;
	}

	return normalizedIdentity;
}

function prioritizeMatchingOption(
	options: INodePropertyOptions[],
	preferredValue?: string,
	label = 'Suggested',
): INodePropertyOptions[] {
	if (!preferredValue) {
		return options;
	}

	const preferredIndex = options.findIndex(
		(option) =>
			typeof option.value === 'string' &&
			option.value.toLowerCase() === preferredValue.toLowerCase(),
	);

	if (preferredIndex <= 0) {
		if (preferredIndex === 0) {
			return [
				{
					...options[0],
					name: `${options[0].name} (${label})`,
				},
				...options.slice(1),
			];
		}

		return options;
	}

	const preferredOption = options[preferredIndex];
	return [
		{
			...preferredOption,
			name: `${preferredOption.name} (${label})`,
		},
		...options.slice(0, preferredIndex),
		...options.slice(preferredIndex + 1),
	];
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
		inputs: [],
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
				description: 'The authentication method to use for connecting to Cosmos DB',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				options: [{ name: 'Select', value: 'select', action: 'Select documents' }],
				default: 'select',
				noDataExpression: true,
			},
			{
				displayName: 'Tool Description',
				name: 'descriptionType',
				type: 'options',
				options: [
					{
						name: 'Automatically From Node Configuration',
						value: 'auto',
					},
					{
						name: 'Define Below',
						value: 'manual',
					},
				],
				default: 'auto',
				description: 'Whether to let n8n generate the tool description or define it manually',
			},
			{
				displayName: 'Tool Description',
				name: 'toolDescription',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				placeholder: 'Describe when the AI agent should use this tool and what inputs it expects',
				description: 'Custom description shown to the AI agent for tool selection and invocation',
				hint: 'Use this when the automatic description is not specific enough for the agent',
				displayOptions: {
					show: {
						descriptionType: ['manual'],
					},
				},
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
				hint: 'This field supports expressions if you need to inject the database ID dynamically.',
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
				hint: 'This field supports expressions if you need to inject the container ID dynamically.',
			},
			{
				displayName: 'SQL Query',
				name: 'sqlQuery',
				type: 'string',
				typeOptions: { rows: 5 },
				default: 'SELECT * FROM c',
				placeholder: 'SELECT * FROM c WHERE c.status = "active"',
				description: 'The SQL query to execute against the container',
				hint: 'Click the Determine by AI model button for this field only when the AI Agent should provide the SQL query.',
				displayOptions: { show: { operation: ['select'] } },
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: true,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { operation: ['select'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				hint: 'Configured limit used when Return All is disabled.',
				displayOptions: { show: { operation: ['select'], returnAll: [false] } },
			},
			{
				displayName: 'Simplify Output',
				name: 'simplifyOutput',
				type: 'boolean',
				default: true,
				description: 'Whether to remove common Cosmos DB metadata fields from the output',
			},
			{
				displayName: 'Exclude Fields',
				name: 'excludeFields',
				type: 'boolean',
				default: false,
				description: 'Whether to exclude additional specific fields from the output',
			},
			{
				displayName: 'Fields to Exclude',
				name: 'fieldsToExclude',
				type: 'string',
				default: 'vector,text',
				placeholder: 'vector,text,rawContent',
				description: 'Comma-separated list of fields to exclude from the output',
				displayOptions: { show: { excludeFields: [true] } },
			},
			{
				displayName: 'Use Dev Override (Custom Endpoint + Token)',
				name: 'useDevOverride',
				type: 'boolean',
				default: false,
				description:
					'Whether to override the selected credentials with a custom endpoint and access token',
			},
			{
				displayName: 'Custom Endpoint',
				name: 'customEndpoint',
				type: 'string',
				default: '',
				placeholder: 'https://your-account.documents.azure.com:443/',
				description: 'The Cosmos DB account endpoint URL to use for the dev override',
				displayOptions: { show: { useDevOverride: [true] } },
			},
			{
				displayName: 'Custom Access Token',
				name: 'customAccessToken',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'The bearer token to use with the custom endpoint override',
				displayOptions: { show: { useDevOverride: [true] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const authenticationType = this.getNodeParameter('authenticationType', 0) as string;
				let client: CosmosClient;
				let preferredUserScopedName: string | undefined;

				const customEndpoint = (
					(this.getNodeParameter('customEndpoint', '') as string) || ''
				).trim();
				const customAccessToken = (
					(this.getNodeParameter('customAccessToken', '') as string) || ''
				).trim();

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
					const endpoint = creds.endpoint as string;
					const oauthTokenData = creds.oauthTokenData as Record<string, unknown>;
					preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
					client = new CosmosClient({
						endpoint,
						aadCredentials: createEntraIdCosmosTokenCredential(this),
					});
				} else {
					const credentials = await this.getCredentials('cosmosDbApi');
					client = new CosmosClient({
						endpoint: credentials.endpoint as string,
						key: credentials.key as string,
					});
				}

				try {
					const { resources } = await client.databases.readAll().fetchAll();
					const options = resources.map((database: { id: string }) => ({
						name: database.id,
						value: database.id,
					}));

					return prioritizeMatchingOption(options, preferredUserScopedName);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new NodeOperationError(this.getNode(), `Failed to load databases: ${message}`);
				}
			},

			async getContainers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const authenticationType = this.getNodeParameter('authenticationType', 0) as string;
				const databaseName = this.getCurrentNodeParameter('databaseName') as string;
				let preferredUserScopedName: string | undefined;

				if (!databaseName) {
					return [];
				}

				let client: CosmosClient;
				const customEndpoint = (
					(this.getNodeParameter('customEndpoint', '') as string) || ''
				).trim();
				const customAccessToken = (
					(this.getNodeParameter('customAccessToken', '') as string) || ''
				).trim();

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
					const endpoint = creds.endpoint as string;
					const oauthTokenData = creds.oauthTokenData as Record<string, unknown>;
					preferredUserScopedName = extractPreferredUserScopedName(oauthTokenData);
					client = new CosmosClient({
						endpoint,
						aadCredentials: createEntraIdCosmosTokenCredential(this),
					});
				} else {
					const credentials = await this.getCredentials('cosmosDbApi');
					client = new CosmosClient({
						endpoint: credentials.endpoint as string,
						key: credentials.key as string,
					});
				}

				try {
					const database = client.database(databaseName);
					const { resources } = await database.containers.readAll().fetchAll();
					const options = resources.map((container: { id: string }) => ({
						name: container.id,
						value: container.id,
					}));

					return prioritizeMatchingOption(options, preferredUserScopedName);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new NodeOperationError(this.getNode(), `Failed to load containers: ${message}`);
				}
			},
		},
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
				aadCredentials: createEntraIdCosmosTokenCredential(this),
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
		const descriptionType = this.getNodeParameter('descriptionType', itemIndex, 'auto') as string;
		const manualToolDescription = this.getNodeParameter('toolDescription', itemIndex, '') as string;
		const fromAiArguments = new Map<string, FromAIArgument>();
		traverseNodeParametersWithParamNames(this.getNode().parameters, fromAiArguments);
		const hasFromAiParameter = (parameterName: string): boolean => {
			const argument = fromAiArguments.get(parameterName);
			return Boolean(argument?.key?.trim());
		};
		const fromAiDescriptionLines = Array.from(fromAiArguments.entries())
			.map(([parameterName, argument]) => {
				const description = argument.description?.trim();
				return description ? `- ${parameterName}: ${description}` : undefined;
			})
			.filter(Boolean)
			.join('\n');
		const sqlQueryFromAiDescription = fromAiArguments.get('sqlQuery')?.description?.trim();
		const sqlQuerySchemaDescription = sqlQueryFromAiDescription
			? `${sqlQueryFromAiDescription}\n\nReturn only a valid Azure Cosmos DB SQL SELECT query, not natural language.`
			: 'Cosmos DB SQL query. Include partition key filter when possible, e.g. WHERE c.category = "hall".';
		const aiControlsSqlQuery = hasFromAiParameter('sqlQuery');

		const baseToolDescription =
			descriptionType === 'manual' && manualToolDescription.trim()
				? manualToolDescription.trim()
				: aiControlsSqlQuery
					? `Query Azure Cosmos DB container "${containerName}" in database "${databaseName}" using SQL select. ` +
						`Input is a JSON object with fields: ` +
						`"sqlQuery" (string, optional: SQL query from the node's Determine by AI model field). ` +
						`Example: {"sqlQuery":"SELECT * FROM c WHERE c.status = 'active'"}`
					: `Query Azure Cosmos DB container "${containerName}" in database "${databaseName}" using the SQL query configured on this node. ` +
						`Do not provide SQL in the tool input unless the SQL Query field is set to Determine by AI model.`;
		const toolDescription = fromAiDescriptionLines
			? `${baseToolDescription}\n\nConfigured From AI field descriptions:\n${fromAiDescriptionLines}`
			: baseToolDescription;
		const selectSchema = aiControlsSqlQuery
			? {
					type: 'object',
					properties: {
						sqlQuery: {
							type: 'string',
							description: sqlQuerySchemaDescription,
						},
					},
					required: [],
					additionalProperties: false,
				}
			: {
					type: 'object',
					properties: {},
					required: [],
					additionalProperties: false,
				};
		const executeTool = async (input: string | Record<string, unknown>): Promise<string> => {
			try {
				let parsed: Record<string, unknown> = {};

				if (typeof input === 'string') {
					try {
						parsed = JSON.parse(input) as Record<string, unknown>;
					} catch {
						parsed = { sqlQuery: input };
					}
				} else if (input && typeof input === 'object') {
					parsed = input;
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

				const sql = String(
					aiControlsSqlQuery ? (parsed.sqlQuery ?? parsed.sql ?? defaultSqlQuery) : defaultSqlQuery,
				).trim();
				const { resources } = await container.items.query(sql).fetchAll();
				if (!resources?.length) {
					return JSON.stringify({ message: 'No results found', operation });
				}

				const limited = returnAll ? resources : resources.slice(0, limit);

				return JSON.stringify((limited as Array<Record<string, unknown>>).map(stripOutput));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new NodeOperationError(
					this.getNode(),
					`Cosmos DB Tool failed during ${operation}: ${message}`,
				);
			}
		};

		const toolName = nodeNameToToolName(this.getNode());

		const { DynamicStructuredTool } = require('@langchain/core/tools') as {
			DynamicStructuredTool: new (config: {
				name: string;
				description: string;
				schema: unknown;
				func: (input: string | Record<string, unknown>) => Promise<string>;
			}) => { name: string };
		};

		const tool = new DynamicStructuredTool({
			name: toolName,
			description: toolDescription,
			// Plain JSON Schema avoids cross-module Zod instanceof issues
			schema: selectSchema,
			func: async (input: string | Record<string, unknown>): Promise<string> => {
				const inputJson: IDataObject =
					typeof input === 'object' && input !== null
						? (input as IDataObject)
						: { input: String(input ?? '') };
				const { index } = this.addInputData(NodeConnectionTypes.AiTool, [[{ json: inputJson }]]);
				try {
					const response = await executeTool(input);
					void this.addOutputData(NodeConnectionTypes.AiTool, index, [[{ json: { response } }]]);
					return response;
				} catch (error) {
					const executionError =
						error instanceof NodeOperationError
							? error
							: new NodeOperationError(this.getNode(), error as Error);
					void this.addOutputData(NodeConnectionTypes.AiTool, index, executionError);
					throw executionError;
				}
			},
		});

		return { response: tool };
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		throw new NodeOperationError(
			this.getNode(),
			'Cosmos DB Tool only supports the AI tool bus. Connect it to an AI Agent via the Tool output.',
		);
	}
}
