import { RepoHelmService } from './service.js';
import type { SubAgent, ModelKit, Quest } from './types.js';

interface TaskAnalysis {
  needs: string[];  // 任务需求标签
  complexity: 'simple' | 'medium' | 'complex';
  estimatedSteps: number;
}

interface WorkerTask {
  agent: SubAgent;
  input: {
    task: string;
    context: any;
  };
}

/**
 * SubAgentOrchestrator - 多 Agent 协作执行 Quest 的编排引擎
 * 
 * 核心职责:
 * 1. 获取入口 Sub-agent 分析任务
 * 2. 根据分析结果路由到 worker agents
 * 3. 并行/串行执行 worker agents
 * 4. 聚合结果并返回
 */
export class SubAgentOrchestrator {
  constructor(private service: RepoHelmService) {}
  
  /**
   * 执行 Quest - 通过多 Agent 协作完成
   */
  async executeQuest(questId: string): Promise<any> {
    // 1. 获取入口 Sub-agent
    const entryAgent = await this.service.getEntrySubAgent();
    if (!entryAgent) {
      throw new Error("No entry sub-agent configured");
    }
    
    // 2. 获取 Quest 信息
    const quest = await this.service.getQuest(questId);
    
    // 3. 入口 agent 分析任务
    const analysis = await this.invokeSubAgent(entryAgent, {
      task: quest.requirement,
      context: { workspaceId: quest.workspaceId }
    });
    
    // 4. 根据分析结果路由到 worker agents
    const workerTasks = this.routeToWorkers(analysis);
    
    // 5. 并行/串行执行 worker agents
    const results = await Promise.all(
      workerTasks.map(task => this.invokeSubAgent(task.agent, task.input))
    );
    
    // 6. 聚合结果
    return this.aggregateResults(results);
  }
  
  /**
   * 调用单个 Sub-agent 执行任务
   */
  private async invokeSubAgent(agent: SubAgent, input: any): Promise<any> {
    try {
      // 1. 获取绑定的 ModelKit
      const modelKit = await this.service.getModelKit(agent.modelKitId);
      if (!modelKit) {
        throw new Error(`ModelKit ${agent.modelKitId} not found for agent ${agent.id}`);
      }
      
      // 2. 构建 AgentBackend
      const backend = this.createBackendFromModelKit(modelKit);
      
      // 3. 应用权限限制
      const restrictedBackend = this.applyPermissions(backend, agent.permissions);
      
      // 4. 执行
      const result = await restrictedBackend.run({
        systemPrompt: agent.promptTemplate || '',
        messages: [{ role: "user" as const, content: input.task }],
        tools: this.filterTools(agent.permissions)
      });
      
      // 5. 更新使用统计
      await this.updateSubAgentUsage(agent.id);
      
      return {
        agentId: agent.id,
        agentName: agent.name,
        success: true,
        result,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Failed to invoke sub-agent ${agent.id}:`, error);
      return {
        agentId: agent.id,
        agentName: agent.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 基于任务分析结果路由到合适的 worker agents
   */
  private routeToWorkers(analysis: TaskAnalysis): WorkerTask[] {
    // TODO: 这里需要从 service 获取所有 worker agents
    // 暂时返回空数组,后续完善
    const workers: SubAgent[] = [];
    
    const tasks: WorkerTask[] = [];
    
    // 基于关键词匹配路由
    if (analysis.needs.includes("specification")) {
      const specAgent = workers.find(w => 
        w.capabilities.includes("specification") || 
        w.capabilities.includes("requirements")
      );
      if (specAgent) {
        tasks.push({ agent: specAgent, input: { task: "生成详细规格", context: {} } });
      }
    }
    
    if (analysis.needs.includes("implementation")) {
      const implAgent = workers.find(w => 
        w.capabilities.includes("coding") || 
        w.capabilities.includes("planning")
      );
      if (implAgent) {
        tasks.push({ agent: implAgent, input: { task: "实现代码", context: {} } });
      }
    }
    
    if (analysis.needs.includes("testing")) {
      const testAgent = workers.find(w => 
        w.capabilities.includes("testing")
      );
      if (testAgent) {
        tasks.push({ agent: testAgent, input: { task: "编写测试", context: {} } });
      }
    }
    
    return tasks;
  }
  
  /**
   * 聚合多个 worker agent 的执行结果
   */
  private aggregateResults(results: any[]): any {
    // 简单聚合:合并所有结果
    return {
      completed: true,
      subAgentResults: results,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * 从 ModelKit 配置创建对应的 AgentBackend
   * TODO: 完整实现需要根据 ModelKit 类型(cli/byok)创建不同的 backend
   */
  private createBackendFromModelKit(modelKit: ModelKit): any {
    // 目前返回 mock backend,后续需要实现真实的 backend 创建逻辑
    return {
      run: async (options: any) => {
        // Mock implementation
        return {
          status: "completed",
          summary: `Mock execution with ModelKit ${modelKit.id}`,
          events: []
        };
      }
    };
  }
  
  /**
   * 应用权限限制到 backend
   * TODO: 实现真正的权限过滤逻辑
   */
  private applyPermissions(backend: any, permissions: any): any {
    // 目前直接返回原 backend,后续需要实现权限包装器
    return backend;
  }
  
  /**
   * 根据权限配置过滤可用工具
   */
  private filterTools(permissions: any): string[] {
    return permissions.allowedTools || [];
  }
  
  /**
   * 更新 Sub-agent 的使用统计
   */
  private async updateSubAgentUsage(agentId: string): Promise<void> {
    await this.service.updateSubAgentUsage(agentId);
  }
}
