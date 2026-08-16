/** 侧栏文件树:根 = 收藏(虚拟目录)。path='' 时显示收藏列表,否则显示该目录内容。 */
import { create } from 'zustand';

interface FileTreeState {
  path: string;      // '' = 收藏根视图;否则相对 FILE_ROOT
  boundary: string;  // 当前进入的收藏路径('' = 在收藏根),树不可越过它
  enter(fav: string): void;   // 点收藏:进入该收藏
  navigate(p: string): void;  // 树内跳转(保持 boundary)
  toRoot(): void;             // 回收藏根
}

export const useFileTreeStore = create<FileTreeState>((set) => ({
  path: '',
  boundary: '',
  enter: (fav) => set({ path: fav, boundary: fav }),
  navigate: (p) => set({ path: p }),
  toRoot: () => set({ path: '', boundary: '' }),
}));
