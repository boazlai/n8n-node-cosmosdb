import type { INodeType, INodeTypeDescription, ISupplyDataFunctions, SupplyData, INodeExecutionData, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
export declare class CosmosDbTool implements INodeType {
    description: INodeTypeDescription;
    methods: {
        loadOptions: {
            getDatabases(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
            getContainers(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]>;
        };
    };
    supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData>;
    execute(): Promise<INodeExecutionData[][]>;
}
