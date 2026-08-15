import { useHubStore } from '../../stores/hubStore';
import { useUiStore } from '../../stores/uiStore';
import { InstanceItem } from './InstanceItem';

/** 实例列表:pinnedOnly 时只列置顶实例(按 label),否则列其余。 */
export function InstanceList({ pinnedOnly }: { pinnedOnly?: boolean }) {
  const instances = useHubStore((s) => s.instances);
  const pinned = useUiStore((s) => s.pinned);
  const list = pinnedOnly
    ? instances.filter((i) => pinned.includes(i.label))
    : instances.filter((i) => !pinned.includes(i.label));

  if (list.length === 0) {
    return <div className="list-empty">（无）</div>;
  }
  return (
    <>
      {list.map((inst) => (
        <InstanceItem key={inst.id} instance={inst} />
      ))}
    </>
  );
}
