import type { AgentPoolEntry, AgentPoolSnapshot, AgentPrototype, DynamicAgent } from "./types.js";

export interface AgentPoolOptions { maxDynamicAgents?: number; }
export interface CreateDynamicAgentInput {
  name: string; role: string; capabilities: string[];
  systemPromptTemplate: string; createdBy: string;
  taskId?: string; ttl?: number; defaultModelKitId?: string;
}

export class AgentPool {
  private prototypes: Map<string, AgentPrototype> = new Map();
  private dynamicAgents: Map<string, DynamicAgent> = new Map();
  private activeAgentIds: Set<string> = new Set();
  private maxDynamicAgents: number;

  constructor(options: AgentPoolOptions = {}) { this.maxDynamicAgents = options.maxDynamicAgents ?? 10; }
  registerPrototype(proto: AgentPrototype): void { this.prototypes.set(proto.id, proto); }
  listPrototypes(): AgentPrototype[] { return Array.from(this.prototypes.values()); }
  getPrototype(id: string): AgentPrototype | undefined { return this.prototypes.get(id); }
  matchAgents(capabilities: string[]): AgentPoolEntry[] {
    return [...this.prototypes.values(), ...this.dynamicAgents.values()].filter((a) => capabilities.some((c) => a.capabilities.includes(c)));
  }
  createDynamicAgent(input: CreateDynamicAgentInput): DynamicAgent {
    if (this.dynamicAgents.size >= this.maxDynamicAgents) throw new Error(`动态 Agent 数量已达上限 (${this.maxDynamicAgents})`);
    const agent: DynamicAgent = { id: `dynamic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: input.name, role: input.role, capabilities: input.capabilities, systemPromptTemplate: input.systemPromptTemplate, defaultModelKitId: input.defaultModelKitId, isBuiltIn: false, createdBy: input.createdBy, createdAt: new Date().toISOString(), taskId: input.taskId, ttl: input.ttl };
    this.dynamicAgents.set(agent.id, agent);
    return agent;
  }
  listDynamicAgents(): DynamicAgent[] { return Array.from(this.dynamicAgents.values()); }
  getDynamicAgent(id: string): DynamicAgent | undefined { return this.dynamicAgents.get(id); }
  recycleDynamicAgent(id: string): void { this.dynamicAgents.delete(id); this.activeAgentIds.delete(id); }
  activateAgent(id: string): void { this.activeAgentIds.add(id); }
  deactivateAgent(id: string): void { this.activeAgentIds.delete(id); }
  getSnapshot(): AgentPoolSnapshot { return { prototypes: this.listPrototypes(), dynamicAgents: this.listDynamicAgents(), activeAgents: Array.from(this.activeAgentIds) }; }
}
