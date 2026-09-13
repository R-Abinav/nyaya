import { Component, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/layout';
import { HomePage } from './components/home-page';
import { JurorsPage } from './components/jurors-page';
import { JurorDetailPage } from './components/juror-detail-page';
import { CasesPage } from './components/cases-page';
import { CaseDetailPage } from './components/case-detail-page';
import { MyPositionsPage } from './components/my-positions-page';
import { DemoTriggerPage } from './components/demo-trigger-page';
import { Button } from './components/ui';

// ─── Error boundary ───────────────────────────────────────────────────────────

type EBState = { error?: Error };

class ErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[Nyaya] render error', error); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
          <p className="text-sm font-medium text-ink">Something went wrong</p>
          <p className="text-sm text-muted-fg max-w-xs">{this.state.error.message}</p>
          <Button onClick={() => this.setState({ error: undefined })}>Try again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Main app shell */}
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/jurors" element={<JurorsPage />} />
          <Route path="/jurors/:id" element={<JurorDetailPage />} />
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/:id" element={<CaseDetailPage />} />
          <Route path="/my-positions" element={<MyPositionsPage />} />
          <Route path="/admin/demo" element={<DemoTriggerPage />} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
