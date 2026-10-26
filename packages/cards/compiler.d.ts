import type { CardDefinition } from '../engine/src/index.js';
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}
export interface CompileOptions {
  mechanics?: Record<string, unknown>;
  identities?: Record<string, string>;
}
export type CardCompileResult =
  | { ok: true; id: string; definition: CardDefinition; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] };
export const CARD_SCHEMA_VERSION: 1;
export function compileCard(source: unknown, options?: CompileOptions): CardCompileResult;
export function canonical(value: unknown): unknown;
