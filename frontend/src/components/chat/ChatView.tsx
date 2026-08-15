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
      />
      <SleepTimer />
      <Composer />
    </div>
  );
}
