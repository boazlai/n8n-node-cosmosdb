# Standard Node Pattern

Use this path for a regular n8n node that participates in the main data flow.

## Use When

- The node reads incoming items from `Main`.
- The node writes outgoing items to `Main`.
- The node is not directly exposed to an AI Agent as a tool.

## Recommended Shape

- `inputs: [NodeConnectionTypes.Main]`
- `outputs: [NodeConnectionTypes.Main]`
- `execute()` performs the runtime work for each input item.

## Implementation Guidance

1. Start with a small set of required parameters.
2. Validate external service configuration before looping over items when possible.
3. Preserve item cardinality unless there is a clear reason to fan out or aggregate.
4. Return ordinary n8n items shaped like `{ json: ... }`.

## Good Fit Examples

- Create or update records in a SaaS API.
- Transform incoming records into a normalized structure.
- Read metadata from a service and return items downstream.

## Avoid This Pattern When

- The node must appear on the AI tool bus.
- The node must expose `AiTool`, `AiEmbedding`, `AiMemory`, or `AiReranker` connections.
- The node is fundamentally retrieval infrastructure for an AI Agent.

## Starter Template

Use `../assets/normal-node.template.ts` as the starting point.

---

## Quick Start

```bash
# Scaffold (declarative HTTP API style — fastest path for n8n Cloud approval)
npm create @n8n/node@latest my-package -- --template declarative/custom
cd my-package
npm run build
npm run dev   # starts n8n at localhost:5678 with hot-reload
```

---

## Official Documentation Links

| Topic                      | URL                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Declarative node tutorial  | https://docs.n8n.io/integrations/creating-nodes/build/declarative-style-node/              |
| Programmatic node tutorial | https://docs.n8n.io/integrations/creating-nodes/build/programmatic-style-node/             |
| Node base file structure   | https://docs.n8n.io/integrations/creating-nodes/build/reference/node-base-files/structure/ |
| Node UI elements           | https://docs.n8n.io/integrations/creating-nodes/build/reference/ui-elements/               |
| CLI tool (n8n-node)        | https://docs.n8n.io/integrations/creating-nodes/build/n8n-node/                            |
| Node linter                | https://docs.n8n.io/integrations/creating-nodes/test/node-linter/                          |
