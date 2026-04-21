---
name: n8n-custom-community-node
description: 'Build, review, debug, test, and publish n8n custom community nodes. Use this skill for any of: creating a new n8n node package from scratch, adding a node to an existing community package, scaffolding with n8n-node CLI or npm create, writing a standard action node, building an AI Agent-callable tool node (AiTool + supplyData), wiring a vector store or hybrid-search node with embeddings and rerankers, bootstrapping the n8n-nodes-starter repo, testing a node locally (npm link or Docker), publishing to npm, submitting for n8n verification, or reviewing community node architecture.'
---

# n8n Custom Community Node

Umbrella entrypoint for all custom n8n node work. Routes to the correct variant reference file and shared foundations. Covers the full lifecycle: scaffold → build → test → publish → verify.

## Variant Selection

Choose exactly one primary path before writing code:

- **Standard node**: regular data-flow node with `Main` input and `Main` output → read `references/normal-node.md`.
- **AI tool node**: agent-callable node with `AiTool` connection and `supplyData()` → read `references/tool-node.md`.
- **Vector store / hybrid-search node**: AI tool node that also consumes embeddings and optionally rerankers → read `references/vector-store-node.md`.

Always read `references/shared-foundations.md` first. It contains scaffold commands, CLI reference, build, testing, publishing, and validation rules that apply to all three variants.

## Core Workflow

1. Classify the requested node variant.
2. Read `references/shared-foundations.md` and the variant-specific reference.
3. Inspect the repo for an existing node with a similar architecture before drafting code.
4. Build the node with the smallest correct architecture for that variant.
5. Validate the TypeScript shape, runtime wiring, and package metadata.
6. If the user wants a public package, keep names generic and avoid repo-specific assumptions.

## Public Repo Guidance

This skill is portable and usable across workspaces:

- Keep example code generic unless the current repo is itself the target package.
- Prefer reusable templates in `assets/` over long inline snippets in reference docs.
- Avoid coupling instructions to one credential type, one service, or one repo path.
- When packaging for GitHub or npm, keep the node package layout conventional.

## Bundled Resources

- `references/shared-foundations.md`: scaffold commands, CLI reference, package structure, naming, testing, publishing, and release checklist.
- `references/normal-node.md`: standard node pattern.
- `references/tool-node.md`: AI tool node pattern.
- `references/vector-store-node.md`: vector store and hybrid-search node pattern.
- `assets/normal-node.template.ts`: starter template for a regular node.
- `assets/tool-node.template.ts`: starter template for an AI tool node.
- `assets/vector-store-node.template.ts`: starter template for a vector store or hybrid-search tool node.
- `research.md`: all sources consulted, verified CLI commands, common pitfalls, and known caveats.

## Common Decision Rule

If the node must be callable by an AI Agent, start from the AI tool architecture—do not adapt a normal node after the fact. If it also needs embeddings, retrieval, or reranking, start from the vector-store template.
