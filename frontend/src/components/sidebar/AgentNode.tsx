import { useState } from 'react';
import type { Agent } from '../../types';
import { useUiStore } from '../../stores/uiStore';

/** 可展开的 agent 行:实验作为子项,点击启动实例。 */
export function AgentNode({ agent }: { agent: Agent }) {
  const [open, setOpen] = useState(false);
  const openStart = useUiStore((s) => s.openStart);
  const hasExp = agent.experiments.length > 0;

  return (
    <div className="agent-node">
      <div
        className="agent-head"
        onClick={() => setOpen((o) => !o)}
        title={agent.description || undefined}
      >
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="name">{agent.name}</span>
        <span className={`badge ${agent.hub ? '' : 'off'}`}>{agent.hub ? '可启动' : '待接入'}</span>
      </div>
      <div className={`agent-children ${open ? '' : 'hidden'}`}>
        {hasExp ? (
          agent.experiments.map((exp) => (
            <div
              key={exp.path}
              className="agent-child"
              onClick={() => openStart(agent.key, exp.label)}
            >
              {exp.label} {(exp.last_used || '').slice(0, 10)}
            </div>
          ))
        ) : (
          <div
            className={`agent-child ${agent.hub ? '' : 'disabled'}`}
            onClick={() => {
              if (agent.hub) openStart(agent.key, agent.label_default);
            }}
          >
            {agent.hub ? '启动实例…' : '未接入 SDK'}
          </div>
        )}
      </div>
    </div>
  );
}
