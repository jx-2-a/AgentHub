import { useCallback, useEffect, useRef, useState } from 'react';

const NEAR_BOTTOM = 80;

/** 聊天区自动跟随滚动:接近底部时新内容自动滚到底。 */
export function useFollowScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return { ref, follow, scrollToBottom };
}
