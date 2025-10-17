import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';
import { createHmac } from 'crypto';

export class HkuCosmosDbCredentialsApi implements ICredentialType {
	name = 'hkuCosmosDbApi';
	displayName = 'HKU Cosmos DB API';
	documentationUrl = 'https://docs.microsoft.com/en-us/azure/cosmos-db/';
	properties: INodeProperties[] = [
		{
			displayName: 'Endpoint',
			name: 'endpoint',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://your-account.documents.azure.com:443/',
			description: 'The Cosmos DB account endpoint URL',
		},
		{
			displayName: 'Access Key',
			name: 'key',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'The primary or secondary key for your Cosmos DB account',
		},
	];

	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		const verb = (requestOptions.method || 'GET').toUpperCase();
		const resourceType = 'dbs';
		const resourceId = '';
		const date = new Date().toUTCString();
		const key = credentials.key as string;

		// Build the signature string
		const text = `${verb.toLowerCase()}\n${resourceType.toLowerCase()}\n${resourceId}\n${date.toLowerCase()}\n\n`;

		// Generate HMAC signature
		const signature = createHmac('sha256', Buffer.from(key, 'base64'))
			.update(text)
			.digest('base64');

		// Build authorization token (DO NOT URL-encode)
		const authToken = `type=master&ver=1.0&sig=${signature}`;

		requestOptions.headers = {
			...requestOptions.headers,
			Authorization: authToken,
			'x-ms-date': date,
			'x-ms-version': '2018-12-31',
		};

		return requestOptions;
	}

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.endpoint}}',
			url: '/dbs',
			method: 'GET',
		},
	};
}
