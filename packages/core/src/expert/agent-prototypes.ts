import type { AgentPrototype } from "./types.js";

export const BUILTIN_EXPERT_PROTOTYPES: AgentPrototype[] = [
  { id: "expert-architect", name: "架构师", role: "系统架构设计和分析", capabilities: ["architecture", "design", "analysis"], systemPromptTemplate: "你是系统架构师。分析需求，设计系统架构，识别模块边界和依赖关系。", isBuiltIn: true },
  { id: "expert-coder", name: "工程师", role: "代码实现", capabilities: ["coding", "implementation", "refactoring"], systemPromptTemplate: "你是全栈工程师。根据任务描述实现代码变更。", isBuiltIn: true },
  { id: "expert-tester", name: "测试工程师", role: "测试编写和执行", capabilities: ["testing", "test-generation", "validation"], systemPromptTemplate: "你是测试工程师。编写高质量测试，遵循 TDD 原则。", isBuiltIn: true },
  { id: "expert-reviewer", name: "审查员", role: "代码审查", capabilities: ["review", "quality", "security"], systemPromptTemplate: "你是代码审查员。审查代码变更的正确性、安全性、性能。", isBuiltIn: true },
  { id: "expert-researcher", name: "调研员", role: "代码调研", capabilities: ["research", "search", "analysis"], systemPromptTemplate: "你是代码调研员。搜索分析代码库，找出可复用代码块。", isBuiltIn: true },
  { id: "expert-frontend", name: "前端专家", role: "前端实现", capabilities: ["frontend", "react", "css", "ui"], systemPromptTemplate: "你是前端专家。实现 React 组件和 CSS 样式。", isBuiltIn: true },
  { id: "expert-backend", name: "后端专家", role: "后端实现", capabilities: ["backend", "api", "database", "server"], systemPromptTemplate: "你是后端专家。实现 API 端点和服务逻辑。", isBuiltIn: true },
];
