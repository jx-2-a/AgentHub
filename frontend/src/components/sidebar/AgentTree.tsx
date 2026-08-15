import { useHubStore } from '../../stores/hubStore';
import { AgentNode } from './AgentNode';

export function AgentTree() {
  const agents = useHubStore((s) => s.agents);
  return <div id="agent-tree">{agents.map((a) => <AgentNode key={a.key} agent={a} />)}</div>;
}
