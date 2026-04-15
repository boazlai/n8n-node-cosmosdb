import type { IExecuteFunctions, ILoadOptionsFunctions, INodeExecutionData, INodeListSearchResult, INodePropertyOptions, INodeType, INodeTypeDescription } from 'n8n-workflow';
export declare class CosmosDb implements INodeType {
    description: INodeTypeDescription;
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
    methods: {
        loadOptions: {
            getDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getContainers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getContainersForContainerOps(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getItemIds(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            searchItemIds(this: ILoadOptionsFunctions, filter?: string): Promise<INodePropertyOptions[]>;
        };
        listSearch: {
            searchItemIds(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult>;
            searchPartitionKeys(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult>;
        };
    };
}
