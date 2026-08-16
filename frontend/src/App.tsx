import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { ChatPage } from './pages/ChatPage';
import { FilesPage } from './pages/FilesPage';
import { HomePage } from './pages/HomePage';
import { SystemPage } from './pages/SystemPage';
import { TermPage } from './pages/TermPage';
import { TranscriptPage } from './pages/TranscriptPage';
import { WaitPage } from './pages/WaitPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat/:sid', element: <ChatPage /> },
      { path: 'wait/:instId', element: <WaitPage /> },
      { path: 'transcripts/:sid', element: <TranscriptPage /> },
      { path: 'term', element: <TermPage /> },
      { path: 'files', element: <FilesPage /> },
      { path: 'system', element: <SystemPage /> },
    ],
  },
]);
