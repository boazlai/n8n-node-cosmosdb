# AI Tool Node Pattern

Use this path for a custom node that an n8n AI Agent should call as a tool.

## Use When

- The node should output `AiTool`.
- The node is selected by an AI Agent rather than only by main data-flow routing.
- The node must register a tool definition through `supplyData()`.

## Required Architecture

Implement both methods:

- `supplyData()` to register the tool name, description, and input schema.
- `execute()` because nodes with `supplyData()` still need an executable runtime method.

Keep the connection shape explicit:

- `outputs: [NodeConnectionTypes.AiTool]`
- `inputs` should list only the sub-node dependencies the tool actually needs.

## Runtime Rule

Do not rely on `supplyData().func` as the main execution path. In practice, the LangChain agent path should end up using the node runtime flow. Put real retrieval or action logic where the node can execute it reliably, and keep the tool registration schema aligned with that runtime contract.

## Schema Rule

Use a structured input schema for the tool. Keep the schema small and explicit. If the tool takes a single query, expose a single `input` property rather than a loose blob.

## Output Rule

Return ordinary n8n items from runtime execution. Preserve arrays and objects as structured values instead of stringifying them unless the downstream contract explicitly requires a string.

## Common Pitfalls

- Building only `supplyData()` and forgetting `execute()`.
- Registering `AiTool` output but still wiring the node like a standard `Main` node.
- Returning stringified JSON blobs instead of structured data.
- Leaving stale `dist/` output in place and testing the wrong artifact.

## Starter Template

Use `../assets/tool-node.template.ts` as the starting point.

---

## Quick Start

```bash
# Scaffold (programmatic style — required for AiTool nodes)
npm create @n8n/node@latest my-package -- --template programmatic/example
cd my-package
# Replace the generated node class with the AiTool + supplyData() architecture
npm run build
npm run dev   # starts n8n at localhost:5678 with hot-reload
```

Note: The scaffold templates generate standard nodes. Switch to the AiTool architecture manually using `../assets/tool-node.template.ts`.

---

## Official Documentation Links

| Topic                           | URL                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AI sub-nodes overview           | https://docs.n8n.io/integrations/builtin/cluster-nodes/                                                            |
| Programmatic node tutorial      | https://docs.n8n.io/integrations/creating-nodes/build/programmatic-style-node/                                     |
| Node base file (execute method) | https://docs.n8n.io/integrations/creating-nodes/build/reference/node-base-files/programmatic-style-execute-method/ |
| CLI tool (n8n-node)             | https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/                                                    |
| Node linter                     | https://docs.n8n.io/integrations/creating-nodes/test/node-linter/                                                  |
