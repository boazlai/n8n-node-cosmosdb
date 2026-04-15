# [Bug / DX] Two undocumented requirements silently break custom AI tool-bus nodes — confusing errors and empty tool results

**n8n version:** 2.x (confirmed on self-hosted, Docker)  
**Node type:** Custom community node implementing `supplyData()` (AI tool bus with `AiEmbedding` / `AiReranker` sub-inputs)  
**Severity:** Developer-experience / documentation gap — causes complete tool failure with no actionable signal; required ~hours of reading n8n internals to diagnose

---

## Summary

Building a custom n8n node that lives on the AI tool bus (`supplyData()` + `AiTool` output) is currently **impossible to get fully working without reading n8n engine internals**. There are **two separate undocumented requirements**:

1. **Bug #1 — `execute()` no-op requirement**: The partial execution engine calls `execute()` on every node in the directed graph, including AI sub-nodes. A pure `supplyData()` node **must also implement `execute()` returning `[[]]`**. Two contradictory errors are produced depending on whether `execute()` is absent or throws.

2. **Bug #2 — `execute()` must also handle runtime tool invocations**: When the AI Agent actually calls the tool at runtime, n8n does **not** call `DynamicTool.func`. Instead, n8n's `makeHandleToolInvocation` calls `execute()` again on the node — this time with the agent's query in `this.getInputData()[0].json.input`. A no-op `return [[]]` silently discards every tool call, returning nothing to the agent.

Both issues are invisible from the API surface, undocumented everywhere, and produce no useful error messages.

---

## Bug #1 — `execute()` no-op requirement

### Steps to Reproduce

1. Create a custom community node with:
   - `outputs: [NodeConnectionTypes.AiTool]`
   - Sub-inputs: `NodeConnectionTypes.AiEmbedding`, `NodeConnectionTypes.AiReranker`
   - A working `supplyData()` that returns a `DynamicTool`
   - **No `execute()` method**
2. Install the node in n8n and add it to a workflow connected to an AI Agent.
3. Click **"Execute workflow"** (partial / manual run).

**Result:**
```
ApplicationError: The node "Cosmos DB Hybrid Search" has a "supplyData" method but no "execute" method.
```

4. Add an `execute()` that throws a descriptive error such as:
   ```typescript
   async execute(): Promise<INodeExecutionData[][]> {
       throw new Error('This node only supports the AI tool bus.');
   }
   ```
5. Click **"Execute workflow"** again.

**Result:**
```
Error: This node only supports the AI tool bus.
  at ExecuteContext.execute (CosmosDbHybridSearchTool.node.ts:639:9)
  at WorkflowExecute.executeNode (workflow-execute.ts:1043:31)
```

Both errors point in opposite directions and neither indicates the correct fix.

---

### Root Cause (traced through n8n internals)

### 1. `runPartialWorkflow2()` adds AI sub-nodes to the main execution stack

When the user clicks "Execute workflow", `WorkflowExecute.runPartialWorkflow2()` calls `recreateNodeExecutionStack()`. This function iterates over **all node types in the directed graph** (including AI tool bus connections such as `ai_tool`, `ai_embedding`, `ai_memory`) and pushes any "dirty" node (one with no existing run data) onto `nodeExecutionStack` with synthetic input data: `{ main: [{ json: {} }] }`.

Our AI tool node has **no incoming `main` connections** by design — it is a pure AI sub-node. But `recreateNodeExecutionStack` does not distinguish between main-flow nodes and AI bus nodes. It pushes the node with empty synthetic data.

### 2. `runNode()` checks for `execute` only — not `supplyData`

```javascript
// packages/core/src/WorkflowExecute.ts (simplified)
if (nodeType.execute) {
    return await this.executeNode(executionData, workflow, node, ...);
}
```

If `execute` exists, it is called unconditionally regardless of whether the node is an AI sub-node intended for `supplyData()`.

### 3. If `execute` is absent, n8n throws a confusing guard error

```javascript
if (nodeType.supplyData) {
    throw new ApplicationError(
        `The node "${node.type}" has a "supplyData" method but no "execute" method.`
    );
}
```

This looks like a validation error but it is actually a runtime guard inside the execution engine — it fires during a partial workflow run, not at install time.

### The (undocumented) fix for Bug #1

```typescript
async execute(): Promise<INodeExecutionData[][]> {
    // n8n's partial workflow runner pushes AI sub-nodes onto the main
    // execution stack. Return empty gracefully — real work is in supplyData().
    return [[]];
}
```

This is the **only correct implementation** for the partial-run scenario. It is not mentioned anywhere in:
- The n8n docs for building custom nodes
- The "Creating nodes" guide
- The `INodeType` / `SupplyData` type definitions
- Any community forum posts (the error messages lead nowhere useful)

> **Critical note**: `return [[]]` is only half the story. See Bug #2 below — this no-op makes the workflow *not crash*, but the tool will still return nothing to the agent.

---

## Bug #2 — `execute()` is also called at tool-invocation time and must return real data

### Steps to Reproduce

1. Apply the Bug #1 fix — add `async execute() { return [[]]; }` to your AI tool node.
2. Connect the node to an AI Agent. Connect an Embeddings node to its `AiEmbedding` sub-input.
3. Run the workflow and ask the agent a question that should invoke the tool.

**Result:** The AI Agent reports it "couldn't find any information" even though:
- Execution status is `success`
- The tool node shows a green check in the execution graph
- The tool node's run data shows `executionTime: ~4ms` (far too fast for a real DB/embedding call)
- `data.ai_tool: [[]]` — the tool returned nothing

There is **no error, no warning, no log line**.

---

### Root Cause — Two-Phase Tool Invocation Architecture

n8n invokes AI tool nodes in two completely separate phases that call different methods:

```
Phase 1 — SETUP (AI Agent node initialises):
  getInputConnectionData('AiTool', itemIndex)
    → calls  nodeType.supplyData.call(context, itemIndex)
    → developer returns { response: DynamicTool }
    → tool is registered in the LangChain agent's tool list

Phase 2 — RUNTIME (agent decides to call the tool):
  makeHandleToolInvocation(...)
    → calls  nodeType.execute.call(context)
    → query is in:  this.getInputData()[0].json.input
    → execute() MUST do the real work and return [[{ json: result }]]
```

**This means `DynamicTool.func` inside `supplyData()` is never called by the LangChain agent at runtime.** The agent goes through n8n's `makeHandleToolInvocation` → `execute()` path instead.

The `func` in `supplyData()` is scaffolding for the tool's metadata (name, description, Zod schema). The actual query execution at runtime happens exclusively in `execute()`.

---

### Evidence from a Real Execution

From execution run data on the Cosmos DB tool node (execution #101, post Bug #1 fix):

```json
"inputOverride": {
  "ai_tool": [[{ "json": { "input": "equipment of ccmr" } }]]
}
```
```json
"executionTime": 4,
"data": {
  "ai_tool": [[]]
}
```

The tool was invoked with a real query. `execute()` returned `[[]]` in 4ms. The embeddings model was never called. The agent received nothing.

---

### The correct `execute()` for a real AI tool

```typescript
async execute(): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();

    // Phase 1: partial-run no-op (called with synthetic { main: [{ json: {} }] })
    if (items.length === 0 || !items[0].json?.input) {
        return [[]];
    }

    // Phase 2: real tool invocation — query is in items[0].json.input
    const query = items[0].json.input as string;

    // ... embed the query, call the DB, collect results ...

    return [results.map(r => ({ json: r }))];
}
```

This pattern is used by all native n8n vector store nodes (e.g. Pinecone, Supabase). It is not documented as a requirement for custom nodes.

---

### Sub-issue: `DynamicTool` vs `DynamicStructuredTool` schema contract

Native nodes use `createToolFromNode` from `@n8n/ai-utilities` which creates a `DynamicStructuredTool` with Zod schema `{ input: z.string().describe('Query to search for. Required') }`. Using a raw `DynamicTool` instead can cause agents to pass the query as a JSON object `{ input: "..." }` to a method expecting a plain string, producing silent failures upstream.

---

### Sub-issue: `logWrapper` required for sub-node output tracking

Native nodes wrap their returned tool with `logWrapper(tool, context)` (also from `@n8n/ai-utilities`). Without this:
- The Embeddings sub-node shows no output data (connection line stays dotted/grey in the UI)
- `addInputData` / `addOutputData` calls inside `supplyData.func` are silently dropped
- Developers see no evidence of why embeddings calls aren't tracked

---

## Expected Behavior

At least one of the following for each bug:

### For Bug #1 (execute no-op)
1. **Documentation**: The "Creating nodes" guide should explicitly state: *"If your node only implements `supplyData()`, you must also implement `execute()` returning `[[]]`. The partial execution engine will call `execute()` on every node in the directed graph, including AI sub-nodes."*
2. **Engine fix**: `recreateNodeExecutionStack()` should detect nodes whose only outputs are AI bus connection types (`ai_tool`, `ai_embedding`, `ai_memory`, etc.) and skip adding them to the main execution stack.
3. **Friendly error**: If `execute()` is called on a node with no incoming `main` connections, emit a warning rather than crashing.

### For Bug #2 (execute must do real work at runtime)
1. **Documentation**: Clearly document the two-phase invocation model: `supplyData()` is called once at setup; `execute()` is called by `makeHandleToolInvocation` on every tool invocation at runtime.
2. **Documentation**: Provide an official minimal template for a custom AI tool node with a working `execute()` that reads from `this.getInputData()[0].json.input`.
3. **Code reference**: The `INodeType` JSDoc or a dedicated "Creating AI tool nodes" guide should reference `DynamicStructuredTool`, `createToolFromNode`, and `logWrapper` from `@n8n/ai-utilities` as the blessed patterns for sub-node tracking.

---

## Impact

Any developer building a custom node that outputs `NodeConnectionTypes.AiTool` and implements `supplyData()` will hit **both** bugs in sequence:

1. Bug #1 produces two contradictory errors. The fix is a `return [[]]` that is discoverable only by reading engine source.
2. Bug #2 produces **no error at all** — the tool silently returns nothing. The only observable symptom is the AI Agent saying it "couldn't find information." With no logs, no error, and `execution: success` showing in the UI, this is extremely hard to diagnose.

This took approximately **4+ hours of reading n8n internals** (`WorkflowExecute.ts`, `get-input-connection-data.js`, `retrieveAsToolOperation.js`, `fromai-tool-factory.js`, `log-wrapper.js`) to fully understand for a developer already familiar with the n8n node API.

---

## Minimal Reproduction

```typescript
import type {
    INodeExecutionData, INodeType, INodeTypeDescription,
    ISupplyDataFunctions, SupplyData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { DynamicTool } from '@langchain/core/tools';

export class MyAiToolNode implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'My AI Tool',
        name: 'myAiTool',
        group: ['transform'],
        version: 1,
        description: 'A minimal AI tool-bus node',
        inputs: [
            { displayName: 'Embeddings', type: NodeConnectionTypes.AiEmbedding, required: true, maxConnections: 1 },
        ],
        outputs: [NodeConnectionTypes.AiTool],
        properties: [],
    };

    // ---- Bug #1 ----
    // Without this, partial runner throws:
    //   "The node 'My AI Tool' has a supplyData method but no execute method."
    // With a throwing body, the engine surfaces that message — opposite direction.
    //
    // ---- Bug #2 ----
    // This no-op is also called by makeHandleToolInvocation when the agent
    // invokes the tool at runtime. Returning [[]] here silently discards every
    // tool call — the agent receives nothing, execution shows success, no error logged.
    //
    // Correct implementation must branch:
    async execute(): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();

        // Phase 1 (partial run): synthetic data, no query — skip gracefully
        if (!items[0]?.json?.input) {
            return [[]];
        }

        // Phase 2 (runtime tool call): agent query arrives here, not in supplyData.func
        const query = items[0].json.input as string;
        const result = `Result for: ${query}`; // replace with real DB/API call
        return [[{ json: { output: result } }]];
    }

    async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
        // func is called only during Phase 1 schema registration — NOT at tool runtime.
        // The agent never actually invokes this func; execute() above handles runtime calls.
        const tool = new DynamicTool({
            name: 'my_ai_tool',
            description: 'Does something useful',
            func: async (input: string) => `Result for: ${input}`, // dead code at runtime
        });
        return { response: tool };
    }
}
```

---

## Suggested Screenshots

If you can provide any of the following they will strengthen the report:

1. **"Has supplyData but no execute" error** — the first error from Step 3 above, shown in the n8n workflow execution panel.
2. **Throwing execute() error** — the second error from Step 5 above (e.g. "This node only supports the AI tool bus"), also in the execution panel. Together with #1, they illustrate the contradictory-error problem.
3. **Workflow editor with dotted connection lines** — screenshot of the AI Agent workflow showing the connection line from the Embeddings node to the tool node and from the tool node to the AI Agent as grey/dotted (not lit up green). This illustrates the `logWrapper` tracking gap (Bug #2 sub-issue).
4. **Execution panel — tool ran but returned nothing** — the Cosmos DB (or custom) tool node showing a green check, `executionTime: ~4ms`, and "No output data" or `[[]]` in the data panel. Side-by-side with the AI Agent output ("I couldn't find any information") shows that "success" in the UI does not mean the tool worked.

---

## Additional Context

- **Native vector store nodes** (Pinecone, Supabase, MongoDB Atlas) work correctly because their `execute()` reads `item.json.input` as the query, embeds it, and returns real results. This dual-path pattern (`execute` handling both the no-op case and the runtime invocation) is not communicated as a requirement anywhere in the custom-node documentation.
- The `DynamicStructuredTool` + `createToolFromNode` + `logWrapper` pattern from `@n8n/ai-utilities` is the blessed way to build AI tool nodes but is not mentioned in any public-facing node development guide.
- The fix was discovered by diffing native vector store source (`retrieveAsToolOperation.js`) with our custom node and tracing `WorkflowExecute.runPartialWorkflow2` → `makeHandleToolInvocation` in the engine source.
