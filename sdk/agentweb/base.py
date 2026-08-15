"""BaseSession — agent 前端（终端 TUI / AgentHub Web）的公共 I/O 契约。

agent 循环通过这个接口与前端交互，不关心前端是终端还是 Web。
TuiSession（Emisinver 终端）与 WebSessionClient（AgentHub）都实现本契约。

零第三方依赖，可整体复制到其他 agent 项目（WAL / learnlove 等）。
"""
from abc import ABC, abstractmethod


class BaseSession(ABC):
    """agent ↔ 前端 的 I/O 契约。

    约定：agent 循环跑在工作线程，这些方法都由工作线程调用，实现必须线程安全。
    """

    # ------------------------------------------------------------------
    # 输出
    # ------------------------------------------------------------------

    @abstractmethod
    def render(self, renderable="", newline=True):
        """输出一行。renderable 可以是字符串（含 markup）或 rich Renderable。

        newline=False 表示半行追加（end="" 场景，如 `▸ 工具名` + ` ✓`）。
        """

    def log(self, text, level="info"):
        """发送一条系统提示，带等级。

        level: "info"（简单信息）| "choice"（需要输入的选择项）|
               "welcome"（欢迎卡片/横幅）| "hint"（提示段）|
               "silent"（只落转录记录、不在聊天屏展示）。
        Web 端按等级渲染为不同样式的气泡；一段一气泡、无内部滚动。
        默认回退：逐行 render（与其他 agent / 终端兼容）。
        """
        for line in str(text).split("\n"):
            self.render(line)

    @abstractmethod
    def set_status(self, text):
        """状态行（思考中 / 休眠倒计时）。空串清除。"""

    @abstractmethod
    def stream_delta(self, text):
        """流式文本增量（实时上屏）。"""

    @abstractmethod
    def stream_end(self, renderable=None):
        """流式结束。renderable 非 None = 用成品替换本次流式块（如 Markdown 最终渲染）。"""

    @abstractmethod
    def user_message(self, text, turn=None):
        """用户消息（agent 主动回显用）。"""

    @abstractmethod
    def tool_event(self, kind, name, args=None, summary=None, ok=None, verbosity=1, error=None):
        """工具调用事件。kind: "start" | "end"。

        前端工具卡显示:args=输入参数, summary=结果, error=错误。
        传 None 则隐藏对应字段。
        """

    # ------------------------------------------------------------------
    # 展示扩展（思考链 / 文件 / 分类 / 参数）
    # ------------------------------------------------------------------

    def thinking_delta(self, text):
        """思考链增量（DeepSeek reasoning_content）。默认忽略（终端走状态行）。"""

    def thinking_end(self):
        """思考块完成。默认忽略。"""

    def send_file(self, path, caption=None):
        """发文件给用户看（图片/文档，内联预览）。默认渲染一行路径。"""
        self.render(f"[dim]📎 {path}{(' — ' + caption) if caption else ''}[/dim]")

    def set_meta(self, label=None, project_root=None):
        """上报分类信息（实验选定等）→ Hub 更新会话/实例标签。默认忽略。"""

    def sleep_start(self, seconds, text=""):
        """定时/休眠开始:前端显示实时剩余时间。seconds=剩余秒数。默认忽略。"""

    def sleep_end(self):
        """定时/休眠结束。默认忽略。"""

    def set_settings(self, settings):
        """声明可控运行时参数（schema + 当前值）。默认忽略。"""

    def on_setting(self, key, value):
        """用户改了某运行时参数（model/thinking/valve 等）。默认忽略。"""

    # ------------------------------------------------------------------
    # 输入
    # ------------------------------------------------------------------

    @abstractmethod
    def ask(self, prompt, mode="input"):
        """阻塞式请求输入。返回文本；被打断或 agent 结束时返回 None。

        mode: "input"（普通输入）| "confirm"（确认对话框，语义 y/N）。
        """

    def require(self, reason, fields):
        """前提条件表单阻塞请求（SSH 账号/密码/动态码、选实验等）。

        返回 {field_key: value}；取消/打断返回 None。
        默认回退：把字段列表折叠成一行 ask（终端模式）。
        """
        labels = "，".join(f.get("label", f.get("key", "")) for f in (fields or []))
        return self.ask((reason + ("：" + labels if labels else "")), mode="input")

    @abstractmethod
    def poll_guidance(self):
        """非阻塞取一条引导输入（工具执行期间用户随时可敲）。无则 None。"""

    @abstractmethod
    def pop_interrupt(self):
        """检查并清除打断标志（Ctrl+C / 打断按钮）。返回是否被打断过。"""

    @abstractmethod
    def sleep(self, seconds):
        """可打断倒计时。到点返回 True；被打断返回 False。"""

    # ------------------------------------------------------------------
    # 能力与可选
    # ------------------------------------------------------------------

    def supports(self, feature):
        """前端是否支持某特性（如 "term" = 真 PTY 透传）。默认全支持。"""
        return True

    def set_prompt(self, text):
        """默认输入提示（无 ask 时显示）。默认忽略。"""

    def seed(self, text):
        """启动期历史回放（TUI 前已有的终端输出）。默认整段一条(一段一气泡)。"""
        if text:
            self.render(text)

    # ------------------------------------------------------------------
    # 生命周期（TUI 特有方法默认 no-op，子类按需覆盖）
    # ------------------------------------------------------------------

    def stop(self):
        """agent 结束，通知前端收尾。"""

    def close(self):
        """结束后清理。"""

    def suspend(self):
        """挂起前端（/term 真 PTY 接管用）。默认 no-op。"""

    def resume(self):
        """恢复前端。默认 no-op。"""

    def dump_log(self):
        """退出后把输出打印回终端（仅 TUI 有意义，Web 默认无操作）。"""
