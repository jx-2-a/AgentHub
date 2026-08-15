import { useChatStore } from '../../stores/chatStore';

/** 运行时参数面板(设置面板左侧列表的「运行时参数」页):改动即发 settings_set。 */
export function RuntimePanel() {
  const settings = useChatStore((s) => s.settings);
  const sendSetting = useChatStore((s) => s.sendSetting);

  if (settings.length === 0) {
    return <div className="settings-empty">（该 agent 未声明可调参数）</div>;
  }

  return (
    <>
      {settings.map((s) => (
        <div className="settings-row" key={s.key}>
          <span className="settings-label">{s.label || s.key}</span>
          {s.type === 'toggle' ? (
            <input
              type="checkbox"
              checked={!!s.value}
              onChange={(e) => sendSetting(s.key, e.target.checked)}
            />
          ) : s.options && s.options.length > 0 ? (
            <select
              value={s.value !== undefined ? String(s.value) : ''}
              onChange={(e) => sendSetting(s.key, e.target.value)}
            >
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label || o.value}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="settings-input"
              type={s.type === 'number' ? 'number' : 'text'}
              value={s.value !== undefined ? String(s.value) : ''}
              onChange={(e) =>
                sendSetting(s.key, s.type === 'number' ? Number(e.target.value) : e.target.value)
              }
            />
          )}
        </div>
      ))}
    </>
  );
}
