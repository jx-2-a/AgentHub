import { useChatStore } from '../../stores/chatStore';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { MessageItems } from './MessageItems';
import { SleepTimer } from './SleepTimer';

export function ChatView({ sid }: { sid?: string }) {
  const messages = useChatStore((s) => s.messages);
  const assistantOpen = useChatStore((s) => s.assistantOpen);
  const assistantBuffer = useChatStore((s) => s.assistantBuffer);
  const thinkingOpen = useChatStore((s) => s.thinkingOpen);
  const thinkingBuffer = useChatStore((s) => s.thinkingBuffer);
  const hasMore = useChatStore((s) => s.hasMore);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const replayDone = useChatStore((s) => s.replayDone);
  const residualStatic = useChatStore((s) => s.residualStatic);
  const loadOlder = useChatStore((s) => s.loadOlder);
  const reportRead = useChatStore((s) => s.reportRead);

  return (
    <div id="chat-view">
      <ChatHeader sid={sid} />
      <MessageItems
        items={messages}
        thinkingOpen={thinkingOpen}
        thinkingBuffer={thinkingBuffer}
        assistantOpen={assistantOpen}
        assistantBuffer={assistantBuffer}
        sid={sid}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        onLoadOlder={loadOlder}
        replayDone={replayDone}
        onReportRead={reportRead}
        residualStatic={residualStatic}
      />
      <SleepTimer />
      <Composer />
    </div>
  );
}
