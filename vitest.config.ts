import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    passWithNoTests: false,
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
  resolve: {
    alias: {
      '@gamerhub/contracts': new URL(
        './packages/contracts/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/domain': new URL(
        './packages/domain/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/agent-runtime': new URL(
        './packages/agent-runtime/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/model-provider': new URL(
        './packages/model-provider/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/game-spec': new URL(
        './packages/game-spec/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/game-planner': new URL(
        './packages/game-planner/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/game-skills': new URL(
        './packages/game-skills/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/engine-adapter': new URL(
        './packages/engine-adapter/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/unity-adapter': new URL(
        './packages/unity-adapter/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/playtest': new URL(
        './packages/playtest/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/evaluator': new URL(
        './packages/evaluator/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/assets': new URL(
        './packages/assets/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/versioning': new URL(
        './packages/versioning/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/sandbox': new URL(
        './packages/sandbox/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/observability': new URL(
        './packages/observability/src/index.ts',
        import.meta.url,
      ).pathname,
      '@gamerhub/runtime-infra': new URL(
        './packages/runtime-infra/src/index.ts',
        import.meta.url,
      ).pathname,
    },
  },
});
