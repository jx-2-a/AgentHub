# Agent Hub 协议规范（框架契约）

> **Hub 是一个多 agent Web 交互框架**。本文件定义 agent 与 Hub 之间的**接口规则**。
> 任何 agent 接入必须遵循此契约。官方实现：`sdk/agentweb`（BaseSession + WebSessionClient）。

---

## 0. 设计原则

1. **后端不依赖前端**：agent + Hub 独立运行，**无浏览器 viewer 也照常工作**。事件持续进
   历史（内存）+ 落盘（JSONL）。前端只是**通信/展示层**，随时断开、随时重连。
2. **随启随用**：重连后重放完整历史 + 当前状态 + 挂起的交互（ask/requirement），
   浏览器看到的就是"离开时的样子"。只要 Hub 进程不关，会话与记录就一直存在。
3. **框架 vs agent**：Hub 提供通用能力（中继/实例/记录/文件/主题/交互/参数控制），
   agent 只实现 BaseSession 契约接入。接口在此定义，agent 照此兼容。
4. **向前兼容**：事件只增不改；未识别 type 前端忽略。

---

## 1. 角色与拓扑

```
Browser (0..N 个，同一会话可多端同看；可全部断开)
   │  WS /ws/chat/{sid}   (JSON 文本帧)
   ▼
Agent Hub (aiohttp 框架，独立进程)
   ▲  WS /ws/agent        (JSON 文本帧)
   │
Agent 实例 (一个或多个；可由 Hub 启动，也可外部自连)
```

- **Session**：一个 agent 连接；即使 0 个 viewer，session 也存活，事件照常记录。
- **Instance**：Hub 启动的 agent 子进程，经 `AGENT_HUB_INSTANCE` 与会话关联。

---

## 2. 传输

- WebSocket，JSON 文本帧（UTF-8）。`heartbeat=30`；断线自动重连（退避），`resume_sid` 续写。
- viewer 连入 `/ws/chat/{sid}` → 重放历史（可重放事件）→ 实时接收；可随时断开。

---

## 3. 框架提供的全部交互与展示

| 类别 | 用途 | 呈现 | 接口 |
|---|---|---|---|
| **`ask` 对话内提问** | 聊天中的简单问题（确认/快速输入） | 输入栏/确认框 | `ask(prompt, mode)` |
| **`requirement` 前提条件** | 聊天**之外**的前提/重建：SSH 账号密码动态码、选实验/对象、微信密钥等 | **独立颜色对话框** | `require(reason, fields)` |
| **`settings` 运行时参数** | **直接操控**：模型列表、当前模型、思考开关、思考强度、权限级别 | 设置面板（下拉/开关） | `set_settings(list)` + `on_setting(key, value)` |
| **`thinking` 思考链** | 展示 agent 推理过程（DeepSeek reasoning_content） | **可折叠思考块**（展开看全文） | `thinking_delta(text)` + `thinking_end()` |
| **`file` 文件展示** | agent 主动发文件给用户看 | **内联预览卡**（图片/文档） | `send_file(path, caption?)` |
| **`tool` 工具卡片** | 工具调用 | 卡片可**展开/收起**参数与返回，可全局**显示/隐藏**工具返回 | `tool_event(start/end)` |

---

## 4. Agent 契约（BaseSession）

Agent 循环跑在**独立工作线程**，方法必须**线程安全**。

### 4.1 输出
| 方法 | 语义 |
|---|---|
| `render(renderable, newline=True)` | 输出一段系统提示（info 级）；整段一条 `log` 事件 |
| `set_status(text)` | 状态行（思考中/休眠倒计时/空串清除） |
| `stream_delta(text)` / `stream_end(renderable=None)` | 流式文本 / 结束（成品替换） |
| `thinking_delta(text)` / `thinking_end()` | 思考链增量 / 结束（可折叠思考块） |
| `user_message(text, turn=None)` | 用户消息回显（气泡） |
| `tool_event(kind, name, args, summary, ok, verbosity)` | 工具调用 start/end（卡片） |
| `send_file(path, caption=None)` | 发文件给用户看（内联预览） |
| `set_meta(label=None, project_root=None)` | 上报分类信息 → 实例自动分类 |
| `set_settings(settings)` | 声明可控运行时参数（schema + 当前值） |
| `seed(text)` | 启动期历史回放 |

### 4.2 输入
| 方法 | 语义 |
|---|---|
| `ask(prompt, mode="input"\|"confirm")` | 对话内**阻塞**提问；返回文本；打断/结束返回 None |
| `require(reason, fields)` | 前提条件**表单**阻塞请求；返回 `{key: value}`；取消返回 None |
| `on_setting(key, value)` | 用户改某运行时参数 → agent 应用并重发 settings |
| `poll_guidance()` | 非阻塞取一条引导输入 |
| `pop_interrupt()` | 检查并清除打断标志 |
| `sleep(seconds)` | 可打断倒计时 |

### 4.3 能力与生命周期
| 方法 | 语义 |
|---|---|
| `supports(feature)` | 是否支持某特性（如 "term"） |
| `stop()` / `close()` | 结束 / 清理 |

---

## 5. 事件协议（agent → Hub → browser）

### 5.1 会话类
| type | 字段 | 语义 |
|---|---|---|
| `register` | `label, file_roots, capabilities, resume_sid?, instance_id?` | 注册 |
| `registered` | `sid` | 分配会话 id（hub→agent） |
| `session_state` | `status` | 会话状态变更（hub 生成） |
| `session_end` | — | agent 结束 |

### 5.2 消息 / 思考 / 文件
| type | 字段 | 语义 |
|---|---|---|
| `log` | `text, level?` | 系统提示段 → **居中气泡**；一段一气泡，按 `level` 区分样式 |
| `user` | `text, turn?` | 用户消息气泡 |
| `assistant_delta` | `content` | 助手流式增量 |
| `assistant_final` | `content` | 替换当前气泡并完成 |
| `assistant_end` | — | 收尾当前气泡 |
| `thinking_delta` | `content` | 思考链增量（追加当前思考块） |
| `thinking_end` | — | 思考块完成（可折叠） |
| `file` | `path, caption?, kind?` | 发文件（内联预览卡） |

> **系统提示等级（`log` 渲染规则）**
> - 每条 `log` = **一个独立气泡**（一段一气泡、无内部滚动）；固定宽度 `--sys-w`（默认 80%）。
> - `level`：`info`（简单信息，左对齐）｜`choice`（启动选择项，等宽卡片，左对齐）｜`welcome`（欢迎横幅，居中）｜`hint`（提示段，💡）｜`silent`（只落转录记录、**不上聊天屏**，如内部调试信息）。
> - **段粒度由 agent 调用决定**：一次 `render(...)` 或 `log(text, level)` = 一段，不要拆成多行调用。
> - `log` 属可重放事件（重连/回看都在）。

> **格式声明约定（agent 端按此选择发送方式）**
> | 内容 | 用什么发 | 前端呈现 |
> |---|---|---|
> | 系统提示 / 横幅 / 菜单 / 提示 | `log(text, level)` | 对应等级的气泡 |
> | **需要系统输入**（实验选择 / SSH / 动态码 / 密钥） | `require(reason, fields)` | 琥珀色气泡 + 表单 |
> | 对话中的提问 / 确认 | `ask(prompt, mode)` | **无气泡**，仅输入提示 |
> | 文件 | `send_file(path, caption)` | 文件卡片 |
> | 助手正文 | `stream_delta` / `stream_end` | markdown 渲染 |
> | 工具调用 | `tool_event` | 工具卡片 |
> - ⚠ **琥珀色"系统询问"气泡只由 `require` 触发**。`ask` 一律不产生气泡，避免聊天时出现突兀的黄框。

### 5.3 工具
| type | 字段 | 语义 |
|---|---|---|
| `tool_start` | `id, name, args?` | 工具卡开始（args=输入参数） |
| `tool_end` | `id, ok, summary?, error?` | 工具卡结束（✓/✗；summary=结果摘要；error=错误信息，前端标红） |

### 5.4 交互 / 控制
| type | 字段 | 语义 |
|---|---|---|
| `status` | `text` | 状态行（`''` 清除） |
| `sleep_start` | `seconds, text?` | 定时/休眠开始：前端显示**实时倒计时条**（seconds=剩余秒数，到点消失，点击可打断） |
| `sleep_end` | — | 定时/休眠结束（清除倒计时条） |
| `ask` | `id, prompt, mode` | 对话内提问（**不产生系统气泡**，prompt 仅作为输入提示） |
| `ask_done` | — | ask 已应答/取消 |
| `requirement` | `id, reason, fields[]` | 前提条件表单（**琥珀色系统气泡 + 表单**） |
| `requirement_done` | — | requirement 已提交/取消 |
| `settings` | `settings[]` | 运行时参数 schema + 当前值 |
| `meta` | `label?, project_root?` | 分类信息 → 更新会话/实例标签 |

### 5.5 下行（hub → agent）
| type | 字段 | 语义 |
|---|---|---|
| `message` | `text` | 普通提交（无 pending ask 时 = 引导） |
| `ask_answer` | `id, text`（null=取消） | ask 应答 |
| `requirement_answer` | `id, values`（null=取消） | requirement 提交 |
| `settings_set` | `key, value` | 用户改运行时参数 |
| `interrupt` | — | 打断 |

---

## 6. 字段类型（requirement 表单 + settings 共用）

```json
{
  "key": "唯一字段名",
  "label": "显示标签",
  "type": "text | password | otp | number | toggle | select | textarea",
  "value": "默认值(可选)",
  "placeholder": "占位提示(可选)",
  "options": [{"label": "...", "value": "..."}]    // select 必填
}
```
- **requirement** 用 `text/password/otp/number/select/textarea`；**settings** 用 `select/toggle/number`。
- **一个 requirement 可混合多种形式**：如选实验 = `select`（列表）+ `text/textarea`（自定义路径/备注），表单同时渲染。
- requirement 用例：SSH（账号/密码/动态码）、选实验/对象、微信密钥等。
- settings 用例：`model`（模型列表下拉）、`thinking`（toggle）、`reasoning_effort`、`valve`（权限）。

---

## 7. 会话生命周期（含前端无关性）

```
1. agent 连 /ws/agent → register → registered（无论有无 viewer）
2. agent 发事件 → Hub 中继给当前 viewer（可能为 0 个）+ 历史 + 落盘
3. viewer 连入 → 重放历史（可重放事件）+ 当前状态 + 挂起交互（last_ask/last_requirement）
4. 所有 viewer 断开 → agent 照常运行，事件继续记录；hub 进程不关，会话永存
5. viewer 重连 → 回到"离开时的样子"（历史 + 状态 + 挂起交互）
6. 断线重连（resume_sid）续写；session_end/进程退出 → exited，记录可回看
```

可重放：`log / user / assistant_* / thinking_* / status / tool_* / settings / file / session_state / requirement / requirement_done`。
不可重放（瞬时）：`ask / ask_done`。

---

## 8. 实例协议

- `data/agents.json`：`venv, cwd, cmd, env, hub, file_root, experiments`。
- 启动：`POST /api/instances {"agent", "label"}` → Popen 无头子进程
  （`venv python <cmd> --hub ws://... --label ... --file-root ...`，env `AGENT_HUB_INSTANCE=<id>`）。
- 关联：register 带 `instance_id` → 实例↔会话。
- 前提条件（随启随用）：启动后 `requirement` 收集前提（SSH/选实验等），满足后 `set_meta` 分类。
- **自动恢复**：在跑实例列表落盘 `data/instances/active.json`；Hub 重启时自动重新拉起
  （agent 重连后新会话；旧会话记录仍在 `/transcripts/` 可回看）。记录永不丢。

---

## 9. 记录与文件

- 事件落盘 JSONL（`data/transcripts/<sid>.jsonl`）；`/transcripts/` 回看；重连续写；Hub 不关即永存。
- 文件：会话注册 `file_roots`；`/file?sid=&path=` `_within` 校验；
  ① 输出里路径 linkify ② agent `send_file` 显式发 → 内联预览卡。

---

## 10. 约束规则

1. 线程模型：agent 循环在工作线程，BaseSession 线程安全；Hub 单事件循环。
2. 事件命名 `snake_case`；未识别 type 前端忽略。
3. 幂等：`registered`/`session_state` 可重复，前端按状态覆盖。
4. 非 SSE 兜底：`stream_end(renderable)` 一律发 `assistant_final` 全量替换。
5. 安全：markdown 先 escape；文件路径 `_within`；默认 127.0.0.1，远程经 Tailscale。
6. 新增事件只增不改旧。
7. 工具卡三字段：`args`（输入）/`summary`（结果）/`error`（错误，标红）——agent 传什么显示什么，传 `None` 隐藏；`verbosity` 兼容保留、不再门控。
8. `ask`/`requirement` 互斥：同一时刻一个 pending 交互。
9. `settings_set` 只影响本会话；agent 应用后重发 `settings` 确认。
10. `file` 的 path 必须在 `file_roots` 内（`/file` 校验），否则显示"无法访问"。

---

## 11. SDK 参考实现

`sdk/agentweb/`：`base.py`（BaseSession）+ `client.py`
（连接/重连/收发/ask/require/settings/thinking/file/引导/打断/set_meta）。

Agent 接入三步：① 安装 `agentweb` ② 实现 BaseSession ③ 主线程 `client.run()`、
agent 循环放工作线程、结束 `client.stop()`。
