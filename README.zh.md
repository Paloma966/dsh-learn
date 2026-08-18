# AI Learning Skill

> 把任何代码仓库变成渐进式编程练习。骨架 → 实现 → 验证理解。

支持三种宿主：**Claude Code**、**Cursor** 与 **DeepSeek Harness**。Claude Code 与 Cursor 的 skill 以指令形式承载这套教学法；`dsh-ai-learning/` 以原生、强制执行的引擎承载它（状态机 + 验证门 + 状态持久化）。

## 问题

读源码是被动的。你读了一万行代码，频频点头，然后发现自己根本解释不了系统是怎么运作的。真正的理解来自**动手构建**——但直接跳进一个生产级代码仓库又太劝退了。从哪开始？

## 解决方案

AI Learning Skill 把复杂的生产级项目变成一个**渐进式填空练习**。AI 会：

1. **分析**架构，识别哪些是核心、哪些是辅助
2. **剥离**非核心功能，保持骨架完整
3. **创建**有序的、带注释的 TODO 桩代码
4. **验证**骨架能编译通过（你可以边做边测试）
5. **追问**你在每个里程碑之后，确认你是真正理解了

你一次实现一块，卡住时有提示，做完后有追问——这些问题逼你去想**为什么**这么设计。

## 怎么运作的

### 阶段一：架构分析

AI 通读整个项目，画出架构图，把分析结论给你确认。你决定保留什么、移除什么。

### 阶段二：创建骨架

在原项目旁边创建 `<project>-simple` 目录。所有类型定义和接口原样保留，业务逻辑替换成带引导的 TODO 桩：

```go
// SaveTask 将任务持久化到 etcd。用户通过 Center API 创建或更新任务时调用。
//
// TODO 3 (★★): 实现任务持久化
//   1. JSON 序列化 TaskInfo
//   2. 写入 etcd: key = common.BuildKey(projectID, taskID)
//   3. 使用 clientv3.WithLease() 保证 Center 崩溃后 key 自动过期
//   4. 返回存储后的 task（可能被应用了默认值）
//
//   提示: a.etcd.KV().Put(ctx, key, value, clientv3.WithLease(leaseID))
//   陷阱: 如果忘记 WithLease，死任务会永远堆积在 etcd 里
func (a *app) SaveTask(task *common.TaskInfo) (*common.TaskInfo, error) {
    return nil, fmt.Errorf("TODO 3: SaveTask not implemented")
}
```

### 阶段三：渐进实现

TODO 按依赖关系排序，不是按文件排：

| 难度 | 内容 | 示例 |
|---|---|---|
| ★ | 阅读和理解数据模型 | 结构体定义、常量 |
| ★★ | 连接基础设施 | 连接 etcd、MySQL |
| ★★★ | 核心业务逻辑 | 调度循环、命令执行 |
| ★★★★ | 分布式协调 | Leader 选举、分布式锁 |

### 阶段四：理解验证

每个里程碑完成后，AI 会问测试**理解深度**的问题：

- "为什么这个数据存 etcd 而不是 MySQL？"
- "如果两个 Agent 同时执行同一个任务会怎样？"
- "追踪一个任务从创建到完成的完整生命周期。哪里有失败风险？"

答得太浅会被追问。目标是你能解释代码不只是**做了什么**，而是**为什么这样设计**。

## DeepSeek Harness 引擎

`dsh-ai-learning/` 是同一套教学法的 DeepSeek Harness 原生实现——也是指令集的权威来源，上面的 Claude Code 与 Cursor skill 都镜像它。

- **状态机** —— 练习按 `analyzing → skeletonizing → learning → complete` 前进（只进不退）。里程碑只有在验证门通过、且所有苏格拉底问题都答对时才会被标记为已验证。
- **`/learn` 命令** —— `/learn new <origin-path>`、`/learn status`、`/learn check [milestone]` 在对话界面驱动练习。
- **3 个模型工具** —— `ai_learning_status`、`ai_learning_next`、`ai_learning_update` 让模型以受校验的方式创建 TODO 与里程碑、推进阶段、提问、给提示、评分。
- **验证门** —— 每个里程碑的构建命令必须真正跑通，里程碑才能被验证。默认 gate 仅覆盖 Go（`go build ./...`）；其他语言需在 `gates` 配置里添加。
- **状态持久化** —— 进度保存在 `<cwd>/.ai-learning/state.json`，跨会话不丢失，非法捷径被直接拒绝。

详见 [`dsh-ai-learning/README.md`](dsh-ai-learning/README.md) 的配置、状态文件结构与已知局限。

## 安装

### 作为 DeepSeek Harness 插件

```sh
dsh plugin --profile <name> add dsh-ai-learning
```

插件强制执行的内容见上文的「DeepSeek Harness 引擎」一节。

### 作为 Claude Code 插件

```bash
# 从市场添加
/plugin marketplace add chun/ai-learning-skill

# 安装
/plugin install ai-learning-skill@ai-learning-skill
```

### 作为独立的 CLAUDE.md

把 `CLAUDE.md` 复制到你的项目根目录。该目录下的 Claude Code 会话就会遵循 AI Learning 的行为准则。

### 配合 Cursor 使用

把 `.cursor/rules/ai-learning.mdc` 复制到项目的 `.cursor/rules/` 目录。想创建学习骨架时激活这条规则。

## 使用方式

```
# 进入你想学习的项目
cd /path/to/complex-project

# 跟 Claude Code 说
> 我想学习这个项目，帮我创建学习骨架

# AI 会：
# 1. 分析架构
# 2. 在隔壁创建 <project>-simple
# 3. 给你带编号的 TODO 列表
# 4. 让你一块一块实现
# 5. 每个里程碑后追问检查
```

## 示例

[EXAMPLES.md](EXAMPLES.md) 包含使用分布式定时任务调度器作为例子的详细对比。

## 怎么知道真的有效

- 你能不看代码讲出完整的数据流
- 你会发现自己在 AI 提问之前就在想"为什么这么设计？"
- 你注意到项目中的设计模式开始出现在你自己的代码里
- TODO 越来越难，但从不让你觉得无从下手

## 自定义

编辑 `skills/ai-learning/SKILL.md` 来调整：
- 哪些功能剥离、哪些保留
- 追问的深度和风格
- 难度级别的阈值

## 许可证

MIT
