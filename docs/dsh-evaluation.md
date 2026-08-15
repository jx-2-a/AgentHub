# 借 deepseek-harness:路线评估

> 决策用文档。2026-08-15。
> 目标:回答「要不要借 `deepseek-harness-master`(dsh),把我们的 AgentHub 做成插件」。

---

## 0. 先问清:你们真正的痛点是什么?

三条路线的答案完全不同,先对齐目标再选路。

| 痛点 | 最匹配的路线 |
|---|---|
| 「聊天界面不够好看 / 交互不够专业」 | **B. 升级自家前端** |
| 「想要 dsh 的能力:插件生态、技能、MCP、子代理」 | **A. 桥接 dsh** |
| 「不想自己维护 hub 和前端,想站在别人肩膀上」 | **A. 桥接 dsh**(但要接受 dsh 上游风险) |
| 「想要最干净的架构,愿意重写 agent」 | **C. 全量迁移进 dsh** |

---

## 1. 现状对照(先别急着比)

| | 我们的 AgentHub | deepseek-harness |
|---|---|---|
| 定位 | **中转 + 展示层**:aiohttp 一个端口,中继 + Web UI + JSONL 记录 | **完整 agent 运行时 + 插件微内核**(Node/Cordis,50 包) |
| 规模 | 后端 ~10 个 Python 文件,前端 ~1000 行手写 | 大型 monorepo,专业 Web UI,持续演进 |
| 核心价值 | 异构 agent(科研/写作/恋爱)零侵入统一接入 | 一切皆插件;会话/预设/技能/subagent/MCP/压缩/沙箱全齐 |
| 谁是大纲 | agent 的 Python 循环(Emisinver/WAL/learnlove) | 假设「大脑 = dsh 自己的 agent 循环」 |

**关键判断:你们在拿「中转层 + UI」和「完整运行时」比。** dsh 里真正值钱的部分(上下文压缩、子代理、plans、workflow)在「大脑仍留在 Python agent」的前提下基本用不上——桥接只用得到它的 **UI + 插件基建**。

---

## 2. 路线 A:桥接 dsh(AgentHub → dsh 插件,保留 Python agents)

**做法**:写一个 Cordis 插件(必须 **TypeScript**),在 dsh 里重开 `/ws/agent` 中继,把 BaseSession 事件映射成 dsh 的 session/event 流,由 dsh 的 Web UI 渲染。**agent 侧一行不改。**

dsh 明确支持这个形态——`docs/cookbook/extension-cookbook.md` 的「外部协议驱动」,ACP / JSON-RPC 是现成参考([packages/acp/acp/README.md](../../deepseek-harness-master/packages/acp/acp/README.md))。你们的线上协议很小很干净([sdk/agentweb/client.py](../sdk/agentweb/client.py)),映射基本顺畅:

| 你们的 | dsh |
|---|---|
| `assistant_delta/final/end` | assistant chunk + 消息提交 |
| `tool_start/end` | 工具活动 |
| `thinking_*` | reasoning |
| `status` | 状态行 |
| `ask` | AskUserQuestion |
| `requirement`(SSH 凭证/选实验/微信密钥) | credentials 机制 |
| `settings`(模型/思考/权限) | 插件设置 tab |
| `file` | 附件卡 |
| `interrupt` | cancel |

**要写的插件件**:
1. WS 服务器 + agent 注册/重连/心跳(等价现在的 `hub/relay.py` / `sessions.py`)
2. 事件双向映射(agent↔dsh session)
3. UI 插件:ConversationNode(会话列表)+ 设置 tab + requirement 弹窗 / 文件卡(部分需自绘,因 dsh Web UI 绑死在自己的会话模型上)
4. 会话持久化 / 记录(可用 dsh 的 JSONL persistence,或保留自己的)

**投入**:
- 学习 Cordis/TS/dsh 插件模型:**1–2 周**(纯 Python 团队)
- 最小 spike(仅 assistant 流式 + tool 卡 + ask):**3–5 天**
- 完整桥接(requirement/settings/file/thinking/多端/主题):**3–6 周**
- 环境:Node + pnpm 工具链,dsh 版本固定(monorepo 需 `pnpm install && pnpm run build`,或用 `npx @deepseek-ai/dsh web`)
- 持续维护:**每次 dsh 大版本(破坏性变更)要适配**

**收益**:专业 Web UI、dsh 生态(技能/MCP/credentials/压缩可选)、未来可逐步把 agent 逻辑搬进 dsh(skills/MCP/工具),DeepSeek 模型适配是一等公民。你们「异构 agent 一屏看」的独特性正是插件存在的理由,不被替代。

**风险**:
- ⚠ dsh 是 **developer preview,README 明确警告「会有破坏性变更」**,迭代极快,上游一改可能就崩。
- ⚠ Web UI 对「外脑会话」支持不完整,高级交互(requirement/settings)要自绘。
- ⚠ 语言断层:插件必须 TS,团队要长期投进去。
- ⚠ 50 包 monorepo,学习曲线陡。

**决策信号**:愿意长期投 TS + 跟进 dsh 上游,并且痛点不只是「界面」而是「想要生态」→ 走 A。

---

## 3. 路线 B:升级自家 Hub 前端(留 Python)

**做法**:重写 `hub/static`(现状约 1000 行手写),借鉴 dsh 的交互:更好的流式 Markdown、会话树、设置面板、文件卡、主题;后端协议 [PROTOCOL.md](../PROTOCOL.md) 完全不动。可选:引入轻量前端构建(Svelte/Preact/TS)取代手写 app.js,或继续手写。

**投入**:
- 前端重做:**1–3 周**(一个熟悉前端的开发),后端零改动
- 零新运行时依赖,无上游风险

**收益**:完全可控、语言一致、AgentHub 现状照常,协议和 SDK 不用碰。以后随时还能再走 A。

**风险**:拼不过 dsh 的专业 UI;功能与生态仍要自己造;投入后如果最终还是想借 dsh,这部分工作会部分浪费。

**决策信号**:痛点主要是「界面不够好看」→ 走 B。**这也是桥接失败时的兜底路线。**

---

## 4. 路线 C:全量迁移进 dsh(agents 重写为 dsh 插件)

**做法**:把 Emisinver / WAL / learnlove 的循环和工具重写为 dsh 插件 + skills + 工具,用 dsh 原生会话。彻底放弃 AgentHub 和 agent 侧 Python 循环。

**投入**:最大。每个 agent 都是独立项目,工具与领域逻辑(SSH、实验管理、写作流水线、恋爱话术)全部移植。

**收益**:完全享受 dsh 运行时(压缩、子代理、plans、workflow),架构最干净,单一平台。

**风险**:投入最大;现有 Python 代码作废;dsh preview 风险依旧。

**决策信号**:只有当你们想长期以 dsh 为平台、愿意重写 agent 时才考虑。**当前阶段不建议。**

---

## 5. 推荐与判断门槛

**推荐路径:A 先行(最小桥接 spike),B 作兜底。**

理由:dsh 的 UI 与生态是真价值,桥接是「保留三个 Python agent 投资」的前提下拿到它的唯一低成本路径;但 preview 风险 + UI 耦合 + TS 断层,不足以支撑一上来就正式立项。先花几天把最小 spike 跑通,用**可度量的标准**做判断。

**spike 成功的门槛**(缺一即判失败、转 B):
1. WAL(或 learnlove)在 dsh Web UI 上:流式输出 + 工具卡 + `ask` 交互,体验**不低于**现在 AgentHub。
2. agent 侧代码零改动,复用现网 BaseSession 协议。
3. 固定 dsh 版本后,`npx @deepseek-ai/dsh web`(或本地 build)可稳定启动,插件可加载。

**若通过门槛**:正式立项把 AgentHub 完整做成插件(3–6 周),同时保留 AgentHub 进程作为回退。
**若不过门槛**:损失 3–5 天,转 B 升级自家前端;两条路都不算白走(A 的协议分析可直接用于 B 的功能清单)。

---

## 附:如果走 A,dsh 关键扩展点速查(来自源码)

- 工具插件:`ctx.tools.register()`(`docs/cookbook/adding-a-tool.md`)
- 钩子/权限:`ctx.on('tools/pre-execute', …)` 瀑布
- UI 插件:`session/event` 订阅 + `agent.followup()/steer()`;业务节点用 `ConversationNodeDefinition` + keyed Chat renderer(`docs/cookbook/adding-a-conversation-node.md`)
- 外部协议驱动(我们要用的形态):`packages/acp/acp/`(stdio JSON-RPC)与 JSON-RPC 例子是最接近的参考
- 子代理提供者:`packages/subagent/subagent-*`(codex/claude-code/acp/dsh-sdk)
- 设置页:`packages/settings/` + 插件设置 tab(`2026-08-11-plugin-settings-tabs`)
- 凭证:`packages/credentials/`(对应我们的 requirement)
- 会话事件流:见 `docs/cookbook/extension-cookbook.md` 的 feature→mechanism 表
