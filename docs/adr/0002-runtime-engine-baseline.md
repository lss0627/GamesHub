# ADR-0002: Runtime and Unity engine baseline

*Status: Accepted for Phase 0 implementation; production adoption remains subject to ADR-0001*  
*Date: 2026-08-30*

## Decision

- Control plane: Node.js 24 LTS, TypeScript 5.x, pnpm 11.19.0.
- Default AgentRuntime candidate: DeepSeek Harness through a platform adapter; Pi is the pinned exit path and must pass the same contract suite.
- Engine: Unity 6.0 LTS `6000.0.80f1`, Web Build Support enabled.
- Primary engine transport: Unity CLI `command/list/status/mcp` plus the pinned Unity Pipeline package, exposed only on worker loopback.
- Fallback: allowlisted Editor batchmode methods for compile, test and Web build. The adapter never accepts arbitrary shell text or `unity eval`.
- Build target: Unity Web with threads and write-capable validation bridges disabled in published artifacts.

## Verification obligations

The selected Harness must pass session idempotency, ordered resumable events, tool rejection and cancellation tests. The Unity adapter must pass structured edit/compile/Play/state/test/build tests and a 100-cycle isolated golden run with at least 95 successful cycles. CLI failure must exercise the batchmode fallback. Any failure keeps the Phase 0 gate open.
