import { useEffect, useReducer, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getTranscript } from '../api';
import type { ServerEvent } from '../types';
import { MessageItems } from '../components/chat/MessageItems';
import { FullscreenToggle } from '../components/common/FullscreenToggle';
import { SidebarToggle } from '../components/common/SidebarToggle';
import { reduceChat } from '../events/reducer';
import { initialChatState, type ChatState } from '../events/types';

/** /transcripts/:sid:只读回看。用本地 reducer 回放,不污染实时 chatStore。 */
export function TranscriptPage() {
  const { sid } = useParams();
  const [state, dispatch] = useReducer(
    (s: ChatState, ev: ServerEvent) => reduceChat(s, ev),
    null,
    () => ({ ...initialChatState(), title: sid ? `会话 #${sid} 回看` : '会话回看' }),
  );
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!sid) return;
    let cancelled = false;
    getTranscript(sid)
      .then((events) => {
        if (cancelled) return;
        for (const ev of events) dispatch(ev);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sid]);

  return (
    <div id="chat-view">
      <header id="chat-header">
        <SidebarToggle />
        <div id="chat-title">{state.title}</div>
        <div id="chat-status">回看</div>
        <div id="chat-actions">
          <FullscreenToggle />
        </div>
      </header>
      {missing ? (
        <div id="messages">
          <div className="log-line">无此会话记录。</div>
        </div>
      ) : (
        <>
          <MessageItems
            items={state.messages}
            thinkingOpen={state.thinkingOpen}
            thinkingBuffer={state.thinkingBuffer}
            assistantOpen={state.assistantOpen}
            assistantBuffer={state.assistantBuffer}
            sid={sid}
            followLive={false}
          />
          {state.settings.length > 0 && (
            <div className="transcript-settings">
              参数:{state.settings.map((f) => f.label || f.key).join(', ')}
            </div>
          )}
        </>
      )}
    </div>
  );
}
