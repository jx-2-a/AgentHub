import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBack } from '../components/common/icons';

interface SysReport {
  mem: { used_gb: number; avail_gb: number; total_gb: number; percent: number };
  cpu: { percent: number; cores: number };
  disk: { used_gb: number; free_gb: number; total_gb: number; percent: number } | null;
  tailscale: {
    available: boolean;
    reason?: string;
    state: string;
    online: boolean;
    hostname: string;
    ips: string[];
    self_ip: string;
    exit_node: { hostname: string; active: boolean } | null;
  };
  vpn_profiles: Array<{ name: string; server: string; tunnel: string; connected: boolean }>;
  processes: Array<{ pid: number; name: string; role: string; cpu: number; mem_mb: number }>;
  host: { hostname: string; uptime_sec: number; python: string; hub: { pid: number; started: string; mem_mb: number } };
}

interface SysSettings {
  notify_enabled: boolean;
  notify_configured: boolean;
  notify_mode: string;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}天${h}小时`;
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分钟`;
}

const ROLE_TAG: Record<string, string> = { Hub: 'Hub', Agent: 'Agent', 终端: '终端' };

/** /system:电脑状态 + 系统工具(设置 → 控制 → 电脑状态)。30s 自动刷新。 */
export function SystemPage() {
  const navigate = useNavigate();
  const [report, setReport] = useState<SysReport | null>(null);
  const [settings, setSettings] = useState<SysSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyTool, setBusyTool] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        fetch('/api/system').then((res) => res.json()),
        fetch('/api/system/settings').then((res) => res.json()),
      ]);
      if (r.error) {
        setError(r.error);
        return;
      }
      setReport(r);
      setSettings(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, [load]);

  const act = useCallback(
    async (url: string, body?: unknown): Promise<Record<string, unknown>> => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        return (await res.json().catch(() => ({}))) as Record<string, unknown>;
      } catch (e) {
        return { detail: String(e) };
      }
    },
    [],
  );

  const runTool = async (
    key: string,
    fn: () => Promise<Record<string, unknown>>,
    opts?: { silent?: boolean; silentLoad?: boolean },
  ) => {
    setBusyTool(key);
    if (!opts?.silent) setMsg(null);
    const r = await fn();
    if (!opts?.silent) {
      setMsg(
        typeof r.detail === 'string' && r.detail
          ? r.detail
          : typeof r.freed_gb === 'number'
            ? `已释放 ${r.freed_gb} G 可用内存(${r.processes} 个进程)`
            : r.ok === false
              ? '操作失败'
              : '完成',
      );
    }
    setBusyTool(null);
    if (!opts?.silentLoad) void load();
  };

  const toggleNotify = async () => {
    if (!settings) return;
    const on = !settings.notify_enabled;
    await runTool(
      'notify',
      () => act('/api/system/settings/notify', { enabled: on }),
      { silent: true, silentLoad: true }, // 开关静默,不弹完成提示
    );
    setSettings((s) => (s ? { ...s, notify_enabled: on } : s));
  };

  if (!report) {
    return (
      <div id="empty-state" className="sys-loading">
        <div className="spinner" />
        <div className="list-empty">加载电脑状态…</div>
      </div>
    );
  }

  const m = report.mem;
  const ts = report.tailscale;

  return (
    <div id="system-page">
      <header id="chat-header">
        <button className="icon-btn" onClick={() => navigate('/')} title="返回" aria-label="返回">
          <IconBack />
        </button>
        <div id="chat-title">电脑状态</div>
        <div id="chat-status">每 30s 自动刷新</div>
        <div id="chat-actions">
          <button className="icon-btn" onClick={() => void load()} title="刷新" aria-label="刷新">
            ⟳
          </button>
        </div>
      </header>

      <div className="sys-body">
        {error && <div className="sys-error">{error}</div>}

        {/* 概览 */}
        <div className="sys-cards">
          <div className="sys-card">
            <label>内存</label>
            <div className="sys-bar">
              <i style={{ width: `${m.percent}%` }} />
            </div>
            <div className="sys-val">
              {m.used_gb} / {m.total_gb} G · 可用 {m.avail_gb} G
            </div>
          </div>
          <div className="sys-card">
            <label>CPU</label>
            <div className="sys-bar">
              <i style={{ width: `${report.cpu.percent}%` }} />
            </div>
            <div className="sys-val">
              {report.cpu.percent}% · {report.cpu.cores} 核
            </div>
          </div>
          {report.disk && (
            <div className="sys-card">
              <label>磁盘</label>
              <div className="sys-bar">
                <i style={{ width: `${report.disk.percent}%` }} />
              </div>
              <div className="sys-val">
                {report.disk.used_gb} / {report.disk.total_gb} G · 空闲 {report.disk.free_gb} G
              </div>
            </div>
          )}
          <div className="sys-card">
            <label>主机</label>
            <div className="sys-host">
              {report.host.hostname}
              <span className="sys-dim">· 开机 {fmtUptime(report.host.uptime_sec)}</span>
            </div>
            <div className="sys-dim">
              Py{report.host.python} · Hub pid {report.host.hub.pid} · {report.host.hub.mem_mb} MB
            </div>
          </div>
        </div>

        {/* Tailscale */}
        <div className="sys-section">
          <h4>Tailscale</h4>
          {!ts.available ? (
            <div className="sys-row">未安装/未找到 Tailscale CLI{ts.reason ? `：${ts.reason}` : ''}</div>
          ) : (
            <>
              <div className="sys-row">
                <span className={`sys-dot ${ts.online ? 'ok' : 'err'}`} />
                <b>{ts.hostname || ts.state}</b>
                <span className="sys-dim">{ts.state}</span>
                {ts.self_ip && <code className="sys-code">{ts.self_ip}</code>}
                {ts.exit_node && (
                  <span className="sys-dim">出口 {ts.exit_node.hostname}{ts.exit_node.active ? '· 启用' : ''}</span>
                )}
              </div>
              {ts.ips.length > 0 && <div className="sys-dim sys-ips">{ts.ips.join(' · ')}</div>}
            </>
          )}
        </div>

        {/* VPN 配置 */}
        {report.vpn_profiles.length > 0 && (
          <div className="sys-section">
            <h4>VPN 配置</h4>
            {report.vpn_profiles.map((v) => (
              <div key={v.name} className="sys-row sys-vpn">
                <span className="sys-name">{v.name}</span>
                <span className="sys-dim">{v.server} · {v.tunnel}</span>
                <span className="sys-flex" />
                <label
                  className={`sys-switch${v.connected ? ' on' : ''}`}
                  title={v.connected ? '断开' : '连接'}
                >
                  <input
                    type="checkbox"
                    checked={v.connected}
                    disabled={busyTool === 'vpn'}
                    onChange={() =>
                      void runTool('vpn', () =>
                        act('/api/system/vpn', {
                          name: v.name,
                          action: v.connected ? 'disconnect' : 'connect',
                        }),
                      )
                    }
                  />
                  <span className="sys-slider" />
                </label>
              </div>
            ))}
          </div>
        )}

        {/* 工具 */}
        <div className="sys-section">
          <h4>工具</h4>
          <div className="sys-tools">
            <button
              className="sys-btn"
              disabled={busyTool !== null}
              onClick={() => void runTool('memfree', () => act('/api/system/memfree'))}
            >
              🧹 释放内存
            </button>
            <button
              className="sys-btn danger"
              disabled={busyTool !== null}
              onClick={() => {
                if (window.confirm('重启 Hub 服务？会短暂断开连接，实例会自动恢复。')) {
                  void runTool('restart', () => act('/api/system/restart'), { silentLoad: true });
                }
              }}
            >
              ⟳ 重启服务
            </button>
          </div>
          {settings && (
            <div className="sys-row sys-notify">
              <span className="sys-name">通知推送</span>
              <span className="sys-dim">
                {settings.notify_configured
                  ? `已配置 · ${settings.notify_mode === 'gotify' ? 'Gotify' : 'Webhook'}`
                  : '未配置'}
              </span>
              <span className="sys-flex" />
              <label className={`sys-switch${settings.notify_enabled ? ' on' : ''}`} title="切换通知推送">
                <input
                  type="checkbox"
                  checked={settings.notify_enabled}
                  disabled={busyTool === 'notify' || !settings.notify_configured}
                  onChange={() => void toggleNotify()}
                />
                <span className="sys-slider" />
              </label>
            </div>
          )}
        </div>

        {/* 本服务进程 */}
        <div className="sys-section">
          <h4>本服务进程</h4>
          {report.processes.length === 0 ? (
            <div className="list-empty">（无）</div>
          ) : (
            report.processes.map((p) => (
              <div key={p.pid} className="sys-row">
                <span className="sys-name">{p.name}</span>
                {ROLE_TAG[p.role] && <span className="sys-tag">{ROLE_TAG[p.role]}</span>}
                <span className="sys-dim">pid {p.pid}</span>
                <span className="sys-flex" />
                <span className="sys-dim">{p.cpu}% CPU</span>
                <code className="sys-code">{p.mem_mb} MB</code>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 底部操作结果状态条 */}
      <div className="sys-status">
        <span className={`sys-status-dot${msg ? ' on' : ''}`} />
        <span>{msg || '就绪'}</span>
      </div>
    </div>
  );
}
