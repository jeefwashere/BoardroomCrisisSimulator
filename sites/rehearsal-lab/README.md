# Rehearsal GPU Lab

This site provides an invited team playground and an authenticated HTTPS inference queue. It does not host the multiplayer room controller or an autonomous ElevenLabs agent.

## Architecture

The selected architecture uses ElevenLabs for speech, LFM3 for conversation, GLiNER for extraction, and the application backend for authority. Read the canonical [AI architecture](../../docs/ai-architecture.md) and [integration guide](../../docs/agent-integration.md) in the parent repository.

The deployed `/docs/ai-architecture.md` and `/docs/agent-integration.md` files are generated copies. Run `python3 scripts/sync_lab_docs.py` from the parent repository after changing those canonical documents, then build and publish the site. Do not put secrets into static documents.

## Development

Use the existing installation if dependencies are unchanged. Run these commands inside this site directory:

```sh
npm run dev
npx tsc --noEmit
npm run build
```

The registered Sites project is stored in `.openai/hosting.json`. Follow the Sites skill for source synchronization, packaging, and publication; reuse that identity and preserve the current audience. A build alone is not a deployment.

## Storage and credentials

D1 tables `jobs` and `workers` hold inference requests and worker liveness. They are separate from gameplay state. Schema changes use `db/schema.ts` and `npm run db:generate`; commit generated migrations and apply them through the supported hosting workflow.

The server environment requires `MEMBER_EMAILS`, `WORKER_TOKEN`, and `APPLICATION_KEY_HASH`. Keep values in hosting secrets. The client's two API credentials stay on the consuming application's backend. The private worker uses a separate authorization secret plus the hosting service token.

Never trust an arbitrary user's supplied owner field. Browser requests use verified platform identity. Application requests share a service identity; the consuming application must enforce its own user and room ownership.

## Runtime

Only `lfm3` and `gliner-base` are enabled. Other model cards describe downloaded candidates. One outbound worker claims requests and calls the private localhost gateway within the authorized GPU allocation. Do not expose the compute node's HTTP port.

Inference stops when the allocation ends. Check `/api/status` before tests and follow the parent repository's operator instructions only when explicitly authorized to administer the cluster. Normal teammates need no Velocity account or SSH access.
