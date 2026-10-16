/**
 * Side-effect import that makes sure every agent tool is registered.
 *
 * Tools register themselves when lib/agent/tools/index.ts is evaluated, but the code that
 * *uses* the registry (the approval dispatcher, the workflow executor, the AI sales mind)
 * only imports registry.ts — so in the running app nothing ever evaluated index.ts and the
 * registry stayed empty ("Tool … is not registered" when approving an action). Those
 * callers import this file so registration happens exactly once per server instance,
 * in the same module graph that later looks the tools up.
 */
import "./index";
