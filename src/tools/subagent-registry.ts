/**
 * Sub-Agent Registry — tracks active sub-agents for status display and management.
 */

export interface SubAgentEntry {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error';
  startedAt: Date;
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  currentActivity?: string;
  result?: string;
  error?: string;
}

const registry = new Map<string, SubAgentEntry>();

export function registerSubAgent(entry: SubAgentEntry): void {
  registry.set(entry.id, entry);
}

export function updateSubAgent(id: string, update: Partial<SubAgentEntry>): void {
  const entry = registry.get(id);
  if (entry) {
    Object.assign(entry, update);
  }
}

export function getSubAgent(id: string): SubAgentEntry | undefined {
  return registry.get(id);
}

export function listSubAgents(): SubAgentEntry[] {
  return Array.from(registry.values());
}

export function removeSubAgent(id: string): void {
  registry.delete(id);
}
