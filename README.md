# Agent Hub

多 agent 统一 Web 聊天系统。多个 agent 实例（Emisinver 科研、WAL 写作、learnlove 等）作为客户端接入，浏览器统一查看/交互。

**独立项目**：Hub 与 agent 解耦。agent 只需接入 `agentweb` SDK（`BaseSession` 契约 + `WebSessionClient`）。

## 能力

- **多 agent 并发**：一个 Hub 端口，多个 agent 会话并列（会话列表 + 各自聊天页）。
- **多端同步**：同一会话桌面 + 手机同时看，实时同步。
- **聊天**：用户/助手气泡、流式 Markdown 渲染、工具卡片（✓/✗）、状态行、确认对话框（`/gate` 跑流水线）、打断按钮。
- **文件页内预览**：agent 输出里的文件路径自动变链接，点开页内预览（图片内联 / 文本）。
- **主题/背景**：明亮/暗黑/墨绿预设 + 强调色，背景图支持 URL 或上传。
- **会话记录**：事件落盘 JSONL，首页「历史会话」可回看；断线重连续写。
- **SSH 兼容**：agent 的 SSH 工具与 `/cmd` 在 web 下可用；`/term`（真 PTY）需终端，web 模式标记不支持。

## 快速开始

```bash
# 1. 安装依赖（venv）
D:\PyVenv\AgentHub\.venv\Scripts\python.exe -m pip install -r requirements.txt
D:\PyVenv\AgentHub\.venv\Scripts\python.exe -m pip install -e sdk   # agentweb SDK

# 2. 启动 Hub
D:\PyVenv\AgentHub\.venv\Scripts\python.exe -m hub.launch --port 8500
#   浏览器打开 http://127.0.0.1:8500
```

## 前端(React)开发 / 构建

```bash
cd frontend
npm install
npm run dev              # 开发:http://localhost:5173(代理 /api /ws → 8500,热更新)
npm run build            # 生产:构建产物输出到 hub/static/(后端直接服务,零后端改动)
```

## 接入 Emisinver（第一个 agent）

```bash
# venv 安装 SDK
D:\PyVenv\Emisinver\.venv\Scripts\python.exe -m pip install -e D:\DsEdit\AgentHub\sdk

# 无头连 Hub（一条命令）
cd D:\DsEdit\Emisinver
D:\PyVenv\Emisinver\.venv\Scripts\python.exe -m ALb.Agent.Local.loop \
    --config ALb\Agent\Local\config.yaml \
    --hub ws://127.0.0.1:8500/ws/agent \
    --label 科研 \
    --file-root <实验目录>
```

也可用环境变量：`AGENT_HUB`、`AGENT_LABEL`、`AGENT_FILE_ROOTS`（分号分隔多个目录）。

## 远程（手机）访问 — Tailscale

```bash
# Hub 绑 0.0.0.0（Tailscale 即安全边界）
python -m hub.launch --bind 0.0.0.0 --port 8500
# 手机访问 http://<tailscale-ip>:8500
```

⚠ 只在可信网络绑 0.0.0.0（Tailscale / 内网）。Hub 自身无 token 鉴权。

## 接入其他 agent（WAL / learnlove）

接入条件：**对话循环跑在独立 worker 线程** + **通过 `BaseSession` 方法而非直接 print 输出**。

1. 安装 `agentweb` SDK（`pip install -e <AgentHub>/sdk`）。
2. `WebSessionClient` 实现 `BaseSession` 契约：
   - 输出：`render` / `set_status` / `stream_delta` / `stream_end` / `user_message` / `tool_event`
   - 输入：`ask`（阻塞，浏览器应答）/ `poll_guidance` / `pop_interrupt` / `sleep`
3. 主线程 `client.run()`，agent 循环放工作线程；结束 `client.stop()`。

**完整实操 + 全部踩坑点见 [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md)**（基于 Emisinver 移植的
真实经验：`require`/`ask` 语义、上下文压缩、重复调用检测、工具批被打断导致 400 等 12 个坑 + checklist）。

**WAL**：`AgentLoop` 已 UI 无关（回调 `on_thinking/on_tool_call/on_response`），映射到 `set_status/stream_delta/tool_event`；把 REPL 搬进 worker 线程、输入改 `client.ask()`。

**learnlove**：`input()` REPL 最简，同样搬进 worker + 改 `ask()`。

## 架构

```
Agent Web Hub（aiohttp，一个端口）
  /  index.html        会话列表 + 主题
  /chat/{sid}          单会话聊天（多端同步）
  /ws/agent            agent 注册（agent 作 WS client 连入）
  /ws/chat/{sid}       浏览器 viewer
  /file?sid=&path=     文件服务（_within 越界校验）
  /transcripts/{sid}   会话记录回看
  /api/*               会话/记录/主题/上传

Agent（任意机器，可多个）：BaseSession ← WebSessionClient(agentweb)
```

## 事件协议

**Agent→Hub→Browser**：`log` `user` `assistant_delta` `assistant_final` `assistant_end` `status` `tool_start` `tool_end` `ask` `ask_done` `session_end` `session_state`
**Browser→Hub→Agent**：`message` `ask_answer`(id,text, null=取消) `interrupt`
**注册**：`{type:"register", label, file_roots, capabilities, resume_sid}` → `{type:"registered", sid}`

## 测试

```bash
D:\PyVenv\AgentHub\.venv\Scripts\python.exe tests\test_hub.py            # Hub+SDK+viewer 协议
D:\PyVenv\Emisinver\.venv\Scripts\python.exe tests\test_chat_integration.py  # chat.py→Hub→浏览器
```

## 目录

```
hub/        Hub 服务（app/sessions/relay/transcripts/files/theme/launch + static/ 存放前端构建产物）
frontend/   React 18 + TS + Vite 前端（npm run build 产出到 hub/static/）
sdk/        agentweb SDK（base.py 契约 + client.py，可 pip install -e）
tests/      无头集成测试
data/       运行时数据（transcripts/ themes/，gitignore）
```
