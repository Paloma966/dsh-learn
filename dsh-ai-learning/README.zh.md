# dsh-ai-learning

[English](README.md) | 中文

把任意代码库变成渐进式的「做中学」练习——带状态追踪的里程碑、真实执行的验证门、可评分的苏格拉底式追问——打包成一个可安装的 DeepSeek Harness 插件 bundle。

插件是机制，教学法是内容：教学法以 bundled skill（`ai-learning`，位于 `assets/skills/ai-learning/` 的可编辑 Markdown）随包发布。模型负责分析与教学，插件负责执行过程约束：进度持久化在 `<cwd>/.ai-learning/state.json`，非法迁移被直接拒绝，没有 gate 执行记录的里程碑永远无法被标记为已验证。

## 安装

```sh
dsh plugin --profile <name> add dsh-ai-learning     # 从 npm
dsh plugin --profile <name> add ./dsh-ai-learning   # 本地路径
dsh plugin --profile <name> add github:you/dsh-ai-learning#<sha>   # 从 git
```

git 安装拉取的是源码：pnpm 会执行包的 `prepare` 脚本（构建），首次安装需按 `dsh` 提示把该包加入 `allowBuilds` 白名单，并固定 commit SHA。

## 使用

### 学习者

| 命令 | 作用 |
|---|---|
| `/learn new <origin-path> [--lang go] [--level beginner] [--module pkg]` | 在当前会话目录创建学习状态 |
| `/learn status` | 查看阶段、里程碑、TODO、问题与 gate 记录 |
| `/learn check [milestone]` | 真正执行该里程碑的验证门（如 `go build ./...`）并落记录 |

然后与 AI 协作：任务匹配时 `ai-learning` skill 会自动加载（学代码库、造学习骨架、教程式练习），也可用 `/ai-learning` 手势显式调用。

### 模型侧

三个工具驱动整个练习（有工具注册表时自动注册）：

- `ai_learning_status` —— 当前阶段、里程碑、TODO、待答问题。
- `ai_learning_next` —— 当前里程碑的 TODO、验证门与苏格拉底问题（含用于评分的预期答案要点）。
- `ai_learning_update` —— 每次调用一个受校验的变更：`create`、`upsert_todo`、`upsert_milestone`、`set_todo_status`、`advance_phase`、`ask_question`、`give_hint`、`assess_answer`、`retry_milestone`、`check_gate`。

进行中的练习每一步都会注入一张进度卡（仅当状态文件变化时重新注入）。

## 配置

全部字段可选，默认 Go 优先。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `stateDir` | `.ai-learning` | 会话 cwd 下存放 `state.json` 的目录 |
| `gates` | `{ go: { build: [go, build, ./...] } }` | 按语言索引的验证门，语言在创建时选定 |
| `maxCapturedOutput` | `8000` | 每条 gate 输出流最多保留的字符数 |

默认 `gates` 表**只覆盖 Go** —— 在 `/learn new` 时选择任何其他语言都会报 `GATE_UNKNOWN`，直到你在 `gates` 里加入该语言。

在 profile 的补丁层覆盖：

```yaml
- id: ai-learning
  name: dsh-ai-learning
  config:
    gates:
      go: { build: [go, build, ./...] }
      rust: { build: [cargo, check] }
      ts: { build: [pnpm, typecheck] }
```

## 状态文件

`<cwd>/.ai-learning/state.json` —— 随骨架仓库走，跨会话持久：

- `phase`：`analyzing → skeletonizing → learning → complete`（只进不退）
- `origin` / `scope`：学什么、按什么难度
- `milestones[]`：id、标题、TODO 引用、可选逐里程碑 gate、苏格拉底问题（`ask`/`expected`/`hints`/状态/提示层级）、状态
- `todos[]`：id、位置、WHAT、步骤、提示、难度（1–4）、状态
- `gates`：创建时快照的语言 gate 表
- `records[]`：每次 gate 执行的退出码、输出与耗时

已验证的里程碑及其 TODO 被冻结——模型无法静默改写历史。

## 开发

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # 先构建（pretest），再跑 52 个 vitest 用例，含基于构建产物的组合测试
pnpm build       # tsdown → lib/index.js，tsc → lib/types/
```

`pnpm pack` 只发布 `lib/`、`cordis.patch.yml` 与 `assets/`。

已针对 DeepSeek Harness 0.1.0-rc.5 实测：`dsh plugin add` 装入测试 profile、`--dump-config` 组合验证、真实 headless 启动下模型通过 `ai_learning_update` 成功创建练习。

## Model Experience

### Request context and condition

#### What the model sees

- skill 目录中的 `ai-learning` 摘要（`name` + `description`）；完整教学法通过 `skill` 工具或 `/ai-learning` 手势加载，`references/examples.md` 按需加载。
- 练习进行中，每个 pre-step 注入一张 user 角色进度卡——仅当状态文件 `updatedAt` 相对该 agent 上次注入发生变化时。卡片含练习指令与完整状态 JSON。
- `ai_learning_status` / `ai_learning_next` / `ai_learning_update` 的工具结果（有界字符串；gate 输出受 `maxCapturedOutput` 截断）。

#### Token effect

无练习状态时零 token。有活动状态时：每次状态变更一张卡片（状态 JSON 随 TODO、里程碑、问题与 gate 记录增长）；工具结果按普通工具结果计费。

#### KV Cache effect

注入发生在 pre-step 边界且只追加；卡片仅在状态变化后出现，未受影响的请求前缀保持稳定。工具结果遵循普通工具结果的缓存行为。

## Known Limitations and Deferred Work

- **宿主契约以结构化接口消费。** 已发布的 `@deepseek-ai/dsh-*` rc.1 依赖树引用了未发布的包，本 bundle 无法安装 dsh 包；`ctx.fs`、`ctx.commands`、`ctx.tools`、`ctx.skills`、`ctx.shell`、`agent/pre-step` 均通过 `src/host-types.ts` 与 `src/fs-types.ts` 中本地声明的结构化接口对接。这些手写接口在宿主契约变化时需手工同步——这是暂未重构的维护负担。待 dsh 包发布完整依赖树后回访。
- **评分要点在工作区中。** `expected` 答案要点随状态文件存储（`ai_learning_next` 可见），执着的学习者可以读到——与原项目就在隔壁属于同一性质的荣誉制泄露；skill 明确要求模型绝不原样展示要点。
- **命令需要命令适配器。** `/learn new|status|check` 仅在交互式组合中注册；headless/ACP 流程改用 `ai_learning_update` 的 `create` / `check_gate`。
- **工具调用需要会话 cwd。** 执行体未挂 agent 时工具直接拒绝。
- **gate 输出做尾部截断** 至 `maxCapturedOutput`（spill 路径不展示）。
- **暂无版本化状态迁移。** `schemaVersion: 1` 校验并拒绝不支持的版本，但没有升级器。
- **语言矩阵只实测了 Go。** gate 表本身是通用的，但端到端只跑过 Go。
