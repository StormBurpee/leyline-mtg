import type { CardDefinition } from '../engine/src/index.js';
import type { Diagnostic } from './compiler.js';
export type PackCompileResult =
  | {
      ok: true;
      definitions: CardDefinition[];
      index: Record<string, string>;
      diagnostics: Diagnostic[];
    }
  | { ok: false; diagnostics: Diagnostic[] };
export function compilePack(
  cards: unknown,
  options?: { mechanics?: Record<string, unknown> },
): PackCompileResult;
