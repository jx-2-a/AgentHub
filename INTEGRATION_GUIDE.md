# Agent 接入 Web UI 经验指南

> 把现有 agent（Emisinver 科研 / WAL 写作 / learnlove 等）接进 AgentHub 网页版的
> **实操经验总结**。基于 Emisinver Work Agent 从终端 TUI → Web 的移植过程，按
> 能直接照做的顺序写。协议本身见 [PROTOCOL.md](PROTOCOL.md)，本文讲**怎么做 + 坑在哪**。

---

## 1. 架构与角色，三句话

```
Browser (网页，0..N 个) ──WS──▶ AgentHub (aiohttp 框架) ◀──WS── Agent (你的程序)
                                    │ 历史落盘 JSONL，可回看/分页/未读锚点
```

1. **Hub 是通用平台**：只负责中继 / 实例 / 记录 / 文件 / 交互 / 参数控制，不认识你的 agent。
2. **你的 agent 只需实现 `BaseSession` 契约**：把原来对终端 print/input 的 I/O，改成调
   `BaseSession` 的方法；协议细节全部由 `WebSessionClient`（agentweb SDK）替你处理。
3. **无浏览器也照常工作**：事件进历史 + 落盘，viewer 随时连入/断开/重连。

SDK 共两个文件（`sdk/agentweb/base.py` + `client.py`），**零第三方依赖**，可以直接复制到
你的 agent 项目，也可以 `pip install -e <AgentHub>/sdk` 装进 venv。

---

## 2. 接入三步走

### Step 1 — 引入 SDK
```bash
pip install -e D:\DsEdit\AgentHub\sdk
# 或直接拷贝 sdk/agentweb/{base.py,client.py} 到你的项目
```

### Step 2 — 把 I/O 全部改走 `_session`（一个全局对象）

`BaseSession` 是接口，`WebSessionClient` 是它的 Web 实现。你的 agent 循环里**不再直接
print / input**，全部换成：

| 原来 | 改成 | 网页呈现 |
|---|---|---|
| `print("普通信息")` | `_session.render(text)` 或 `_session.log(text)` | info 气泡 |
| 横幅 / 启动信息 / 提示 | `_session.log(text, "welcome"\|"choice"\|"hint")` | 对应样式气泡 |
| 状态行（思考中/倒计时） | `_session.set_status(text)` | 顶部状态行 |
| 流式输出 | `_session.stream_delta(t)` … `_session.stream_end(md)` | Markdown 渲染 |
| 思考链（DeepSeek reasoning） | `_session.thinking_delta(t)` … `_session.thinking_end()` | **可折叠思考块** |
| 工具调用 | `_session.tool_event("start", name, args)` … `("end", …, ok, summary, error)` | 工具卡片（✓/✗，可展开） |
| 用户输入 | `_session.ask(prompt)` / `_session.ask(prompt, "confirm")` | 输入栏 / 确认框（**无气泡**） |
| 需要系统提供信息（SSH 密码/动态码/选实验/密钥） | `_session.require(reason, fields)` | **琥珀色表单**（独立对话框） |
| 发文件给用户看 | `_session.send_file(path, caption)` | 内联预览卡 |
| 分类信息（实验名/路径） | `_session.set_meta(label, project_root)` | 会话/实例自动分类 |
| 休眠倒计时 | `_session.sleep(seconds)` | 实时倒计时条，可点击打断 |
| `input()`（工具执行中收用户消息） | 定期 `_session.poll_guidance()` | 网页输入栏随时可发 |

### Step 3 — 线程模型（最容易搞错的一步）

```python
# 主线程：跑 WebSessionClient 的 asyncio 事件循环
client = WebSessionClient(hub_url, label="科研", file_roots=[...])
t = threading.Thread(target=client.run)     # run() 内部是 asyncio 事件循环
t.start()

# 工作线程：你的 agent 循环，所有 BaseSession 方法都从这调（线程安全）
run_agent_loop(...)                          # 内部用 _session 输出/输入

client.stop()                                # 结束
```

- **对话循环必须跑在独立 worker 线程**，主线程 `run()` 占住事件循环。
- `BaseSession` 的实现都做了线程安全（`call_soon_threadsafe` 入队），放心从工作线程调用。
- 结束用 `client.stop()`：设 done + interrupt，唤醒卡在 ask/sleep 的 worker，关闭 WS。

---

## 3. 输入语义，三条铁律

1. **`ask` ≠ `require`**：
   - `ask` = 对话中的提问/确认 → **不产生系统气泡**，只有输入提示（避免聊天时冒黄框）。
   - `require` = 聊天之外的前提/重建（SSH 账号密码动态码、选实验/对象、密钥）→ **琥珀色气泡 + 表单**。
   - 选"要不要做某事"用 `ask(confirm)`；"给我账号密码"用 `require`。
2. **表单字段**：`fields` 是数组，一个 requirement 可混 `text/password/otp/number/select/textarea`。
   `select` 的 `options` 是 `[{"label","value"}]`，给个 `value` 默认值，不然下拉可能空白。
3. **工具循环里要定期 `poll_guidance()`**：用户在你调工具/思考时随时能打字，消息进引导队列。
   不 poll，他的消息只能等下一轮。每执行完一个工具 poll 一次，拿到就 break 出来处理。

---

## 4. 踩坑清单（都是真实出过的问题）

### ① `require` 弹窗期间，普通输入把表单用字符串解析掉 → 崩溃
- 症状：`'str' object has no attribute 'get'`，agent 崩。
- 根因：SDK 的 `message`（普通提交）handler 也去应答 pending requirement。
- 修法：`message` 只应答 `ask`，requirement 只能由 `requirement_answer` 应答
  （见 `client.py::_on_ws_message`）。

### ② viewer 连入时要求重复投递 → 表单/弹窗双份
- 症状：同一条 requirement/ask 浏览器收到两次。
- 根因：重放历史（含 requirement）+ 单独补发 last_requirement = 双发。
- 修法：**先把 history/last_ask/last_sleep 快照，再加 viewer**；`_REPLAYABLE` 集合管
  哪些事件重放、哪些只补发。

### ③ 长会话上下文溢出 → LLM 报错停摆
- 症状：聊久了发请求直接 400/超限。
- 修法：输入估算（`len(content)//4 + 8` 每条）超预算的 **60%** 时，把早期对话交给 LLM
  压成一条摘要（保留开头 system 上下文 + 最近 20 条），失败就不压缩、不阻塞。
- 注意：**压缩切点不能落在工具调用轮中间**——recent 以 `tool` 消息开头或 old 以
  `assistant(tool_calls)` 结尾时要把切点向前收拢，否则拆散一轮工具调用照样 400。

### ④ 模型死循环调工具 → 无限烧 token
- 症状：同一工具同参数反复调，一直不结束。
- 修法：**重复调用检测**——同 (工具, 参数) 签名连续 5 次 → 注入提醒并跳过本次执行；
  连续 10 次 → 注入强断消息，强制结束工具循环。
- ⚠ 不要设"工具轮数上限"兜底（如 30 轮）：agent 查文件/查数据常常要几十轮，上限会误伤。

### ⑤ 用户引导注入打断工具批次 → `"tool_calls must be followed by tool messages"` 400
- 症状：用户在你思考/调工具时发消息提醒，接着就报这个错。
- 根因：引导注入在工具批循环里 `break`，批次内**还没执行到的 tool_call 没有对应 tool 消息**，
  assistant `tool_calls` 悬空，下轮请求被 API 拒绝。
- 修法：批循环结束后**兜底给所有未回应的 tool_call_id 补一条 `已中断，未执行` tool 消息**
  （打断 / 强断 / 引导注入三条路都覆盖）。

### ⑥ SSH 2FA 动态码过期/输错
- 症状：动态码过期后认证失败，卡住。
- 修法：认证异常时清掉 stale code，重新发一次 `require` 表单（`otp` 字段），只重试一次。

### ⑦ 一次打断出两条提示
- 症状：点一次「打断」，浏览器冒出"已发送 Ctrl+C 到 N 个进程"+"已打断"两条。
- 修法：合并成一条，远端进程数并入括号里。

### ⑧ 网页版不要截断
- 根因：`outputs.clip/clip_list` 把长输出截断 + 溢出缓存，网页不怕刷屏。
- 修法：Web 版 `clip` 直接透传（终端版保留截断）。tool 卡片可展开/收起，长结果交给卡片。

### ⑨ 重启后丢失会话 / 要重问实验路径
- 修法：agent 侧把 `sid + project_root` 存进 `agent_state.json`，重启时带 `resume_sid` 连回
  原会话；一次性信息（如实验路径）从状态文件读，不重问。Hub 侧会话元数据落盘
  `data/sessions.json` + 从转录重放历史，Hub 重启后 `restore()` 重建。

### ⑩ SYSTEM_PROMPT / 回复格式不统一
- 根因：prompt 里 `**`、`★`、`「」`、编号和 `-` 混用，模型输出跟着乱。
- 修法：prompt 统一"编号用于工作流、`-` 用于列表"，去掉富文本装饰符。web 端气泡按 `log`
  的 level 呈现，系统提示里不要塞 emoji。

### ⑪ aiohttp 在非主线程 loop 上 `ws_connect` 卡死
- 根因：Windows + Python 3.14 实测，默认连接器在子线程 loop 上会卡。
- 修法：`aiohttp.ClientSession(connector=aiohttp.TCPConnector())` 显式指定。

### ⑫ 流式空回复
- 防御：SSE 收到空 done（吞包）时，别静默——提示"LLM 返回了空回复"，让用户重试。

---

## 5. 高级能力（按需接）

| 能力 | 接口 | 说明 |
|---|---|---|
| 思考链 | `thinking_delta` / `thinking_end` | DeepSeek `reasoning_content` → 前端可折叠思考块（像 Claude） |
| 运行时参数面板 | `set_settings(list)` + 覆盖 `on_setting(key, value)` | 模型下拉、思考开关、权限级别，改了即时生效（热重载） |
| 发文件 | `send_file(path, caption)` | 图片/文档内联预览 |
| 分类 | `set_meta(label, project_root)` | 会话自动归入实验/项目 |
| 断线重连续写 | `resume_sid` + 自动退避重连 | SDK 内置；重连后补发缓冲 + 重发 pending ask/requirement |
| 由 Hub 托管启动 | `AGENT_HUB_INSTANCE` 环境变量 | 实例协议见 PROTOCOL §8 |
| `/term` 真 PTY | `supports("term")` 返回 False | web 不支持就标 False，前端提示 |

---

## 6. 新 agent 接入 checklist

- [ ] `pip install -e <AgentHub>/sdk`（或拷贝 `base.py` + `client.py`）
- [ ] 全局 `_session = WebSessionClient(hub_url, label, file_roots, resume_sid=…)`
- [ ] 所有 `print` → `_session.render/log`；`input()` → `_session.ask`
- [ ] 对话循环搬进 worker 线程；主线程 `client.run()`；结束 `client.stop()`
- [ ] 工具循环里每执行一个工具 `poll_guidance()` + `pop_interrupt()`
- [ ] 工具批循环结束兜底补未回应 tool_call（防 ⑤）
- [ ] 模型有 reasoning → `thinking_delta/thinking_end`
- [ ] 需要系统输入（密码/动态码/选对象）→ `require` 表单，别用 `ask`
- [ ] 长会话 → 上下文压缩（60% 阈值，切点别拆工具轮）
- [ ] 重复调用检测（5 提醒 / 10 强断），不设轮数上限
- [ ] 重启续接：`agent_state.json` 存 sid + 一次性信息，带 `resume_sid` 重连
- [ ] Web 版不截断输出
- [ ] 自测：`tests/test_hub.py`（协议层）+ `tests/test_chat_integration.py`（agent→Hub→浏览器）

---

## 7. 测试

```bash
D:\PyVenv\AgentHub\.venv\Scripts\python.exe tests\test_hub.py            # Hub+SDK+viewer 协议
D:\PyVenv\Emisinver\.venv\Scripts\python.exe tests\test_chat_integration.py  # 注入 WebSessionClient 驱动 chat 分发
```

集成测试能直接注入 `WebSessionClient` 驱动你的 chat 模块（`_user_echo` / `_tool_start` /
`_tool_end` / `_stream_response`），无浏览器也能验证分发逻辑。
