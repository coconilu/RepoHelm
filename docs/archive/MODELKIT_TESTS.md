# ModelKit 功能测试说明

## 概述

本文档说明了为 ModelKit "保存为 ModelKit" 功能创建的全面测试用例,确保该功能的可靠性和防止回归。

## 背景

之前发现了一个关键 bug:后端 schema 中 `apiKey` 和 `baseUrl` 被定义为必需字段,但 CLI 类型的 ModelKit 不需要这些字段,导致保存失败。虽然已修复,但需要添加测试防止回归。

## 测试文件

### 1. Service 层单元测试 (`packages/core/src/service.test.ts`)

**位置**: `ModelKit Management` describe 块

**测试内容**:

#### testAndSaveModelKit 方法测试

1. **应该成功保存 CLI 类型的 ModelKit(不需要 apiKey/baseUrl)**
   - 验证 CLI 类型可以成功保存
   - 确认配置中不包含 apiKey/baseUrl
   - **这是防止之前 bug 回归的关键测试**

2. **应该允许 CLI 类型不提供 apiKey 和 baseUrl**
   - 明确测试 CLI 类型可以在没有 apiKey/baseUrl 的情况下工作
   - 验证配置对象的结构正确性
   - **直接针对之前发现的 bug**

3. **BYOK 类型缺少 providerId 时应该抛出错误**
   - 验证 BYOK 类型的必需字段验证

4. **CLI 类型缺少 backendId 时应该抛出错误**
   - 验证 CLI 类型的必需字段验证

5. **CLI 类型使用无效的 backendId 应该抛出错误**
   - 验证错误处理逻辑

6. **测试失败时应该抛出错误**
   - 验证当 CLI 测试失败时的错误处理

7. **重复的 ModelKit ID 应该抛出错误**
   - 验证唯一性约束

8. **应该可以自定义 costTier 和 performanceProfile**
   - 验证可选字段的正确处理

9. **应该列出所有已保存的 ModelKits**
   - 验证列表功能

10. **应该可以更新现有的 ModelKit**
    - 验证更新功能

11. **更新不存在的 ModelKit 应该抛出错误**
    - 验证更新的错误处理

12. **应该可以删除 ModelKit**
    - 验证删除功能

13. **删除不存在的 ModelKit 应该抛出错误**
    - 验证删除的错误处理

#### createModelKit validation 测试

1. **CLI 类型必须提供 backendId**
   - 验证创建时的字段验证

2. **BYOK 类型必须提供 providerId**
   - 验证创建时的字段验证

### 2. Server API 集成测试 (`apps/server/src/index.test.ts`)

**测试内容**:

#### POST /api/model-kits/test-and-save

1. **应该接受 CLI 类型的请求(无 apiKey/baseUrl)**
   - 验证 API 端点接受 CLI 类型请求
   - 确认返回 201 状态码
   - 验证响应数据结构
   - **关键的 API 层测试**

2. **应该接受 BYOK 类型的请求(有 apiKey/baseUrl)**
   - 验证 API 端点接受 BYOK 类型请求
   - 区分 schema 验证错误和运行时错误

3. **BYOK 类型缺少 providerId 时应该返回 400**
   - 验证 API 层的字段验证

4. **CLI 类型缺少 backendId 时应该返回 400**
   - 验证 API 层的字段验证

5. **无效的 type 值应该返回 400**
   - 验证 enum 验证

6. **缺少 name 字段应该返回 400**
   - 验证必需字段

7. **缺少 model 字段应该返回 400**
   - 验证必需字段

8. **无效的 costTier 值应该返回 400**
   - 验证 enum 验证

9. **无效的 performanceProfile 值应该返回 400**
   - 验证 enum 验证

#### GET /api/model-kits

1. **应该返回空数组当没有 ModelKits 时**
   - 验证空状态处理

2. **应该返回已创建的 ModelKits**
   - 验证列表功能

#### DELETE /api/model-kits/:id

1. **应该可以删除已创建的 ModelKit**
   - 验证删除功能

2. **删除不存在的 ModelKit 应该返回 400**
   - 验证错误处理

#### Schema Validation Edge Cases

1. **应该接受空的 apiKey 和 baseUrl 对于 CLI 类型**
   - 验证边界情况处理

2. **应该接受可选的 costTier 和 performanceProfile**
   - 验证默认值设置

3. **应该拒绝空字符串的 name**
   - 验证字符串长度验证

4. **应该拒绝空字符串的 model**
   - 验证字符串长度验证

## 运行测试

### 运行所有测试

```bash
pnpm test
```

### 仅运行 core 测试

```bash
pnpm --filter @repohelm/core test
```

### 运行 server 测试

```bash
pnpm --filter @repohelm/server test
```

## 关键测试场景

### 最重要的测试

**CLI 类型可以在没有 apiKey/baseUrl 的情况下保存**

这是之前出问题的地方,以下测试专门防止这个问题再次发生:

1. `packages/core/src/service.test.ts`:
   - "应该成功保存 CLI 类型的 ModelKit(不需要 apiKey/baseUrl)"
   - "应该允许 CLI 类型不提供 apiKey 和 baseUrl"

2. `apps/server/src/index.test.ts`:
   - "应该接受 CLI 类型的请求(无 apiKey/baseUrl)"
   - "应该接受空的 apiKey 和 baseUrl 对于 CLI 类型"

### 测试覆盖的关键点

1. **Schema 验证**: Zod schema 正确地定义了可选字段
2. **Service 层逻辑**: testAndSaveModelKit 方法正确处理不同类型
3. **API 层验证**: Hono 路由正确处理请求验证
4. **错误处理**: 各种错误情况都有适当的错误消息
5. **数据完整性**: ModelKit 的唯一性、更新、删除等操作

## 测试设计原则

1. **隔离依赖**: 使用 `createModelKit` 而不是 `testAndSaveModelKit` 来避免依赖真实的 CLI 可用性
2. **明确的断言**: 每个测试都有清晰的期望和验证
3. **边界情况**: 测试空值、缺失字段、无效值等边界情况
4. **错误路径**: 不仅测试成功路径,也测试失败路径
5. **中文注释**: 测试描述使用中文,便于团队理解

## 维护建议

1. **定期运行测试**: 每次修改 ModelKit 相关代码后运行测试
2. **保持测试同步**: 当 API 或 schema 变更时,及时更新测试
3. **添加新测试**: 发现新的 bug 时,先添加测试再修复
4. **审查测试覆盖率**: 定期检查是否有未覆盖的代码路径

## 相关文件和代码

- **Service 实现**: `packages/core/src/service.ts` (testAndSaveModelKit 方法)
- **类型定义**: `packages/core/src/types.ts` (TestModelInput, ModelKit 等)
- **Server API**: `apps/server/src/index.ts` (/api/model-kits/test-and-save 端点)
- **Schema 定义**: `apps/server/src/index.ts` (testModelSchema)

## 历史问题

**Bug**: CLI 类型的 ModelKit 保存失败,因为 schema 要求 apiKey 和 baseUrl

**根本原因**: 
- Zod schema 将 apiKey 和 baseUrl 定义为必需字段
- CLI 类型不需要这些字段,只需要 backendId

**解决方案**:
- 将 apiKey 和 baseUrl 改为可选字段 (`.optional()`)
- 在 service 层根据 type 验证不同的必需字段

**预防措施**:
- 添加了全面的测试用例
- 特别关注 CLI 类型在没有 apiKey/baseUrl 时的行为
- 验证 schema、service 和 API 层的正确处理
