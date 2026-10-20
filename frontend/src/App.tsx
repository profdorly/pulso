import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import { DAILY_SINCE } from "./lib/editionPaths.js";
import { useIsClient } from "./lib/useIsClient.js";
import { Colophon } from "./components/pulso/Colophon.js";
import { Masthead } from "./components/pulso/Masthead.js";
import { ReaderErrorBoundary } from "./components/pulso/ReaderErrorBoundary.js";
import { ArchivePage } from "./pages/ArchivePage.js";
import { EditionPage } from "./pages/EditionPage.js";
import { HomePage } from "./pages/HomePage.js";
import { MethodologyPage } from "./pages/MethodologyPage.js";
import { ModelsPage } from "./pages/ModelsPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";

/** Weekly audio: player and transcript live in their own chunk, loaded only where they render. */
const Weekly = lazy(() => import("./pages/Weekly.js"));

function WeeklyRoute() {
  const isClient = useIsClient();
  return isClient ? (
    <Suspense fallback={null}>
      <Weekly view="page" />
    </Suspense>
  ) : null;
}

/**
 * Guards the date route of the daily edition (`/2026-10-09`).
 *
 * `/:date` would otherwise take every unknown one-segment path as an edition date.
 */
function DateRoute({ children }: { children: ReactNode }) {
  const date = useParams().date ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= DAILY_SINCE ? children : <NotFoundPage />;
}

/**
 * The reader's shell and routes.
 *
 * Every route is rendered to static HTML at build time and ships without a script. Only the weekly
 * audio (its page, and its card on the cover when an episode exists) hydrates in the browser.
 */
function App() {
  return (
    <div className="theme-brasa relative min-h-screen bg-background text-primary">
      <div className="brasa-atmosphere" aria-hidden="true" />
      <a href="#conteudo" className="pulso-skip">
        Pular para o conteúdo
      </a>
      <div className="pulso-shell">
        <Masthead />
        <main id="conteudo" tabIndex={-1} className="outline-none">
          <ReaderErrorBoundary>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/arquivo" element={<ArchivePage />} />
              <Route path="/arquivo/:page" element={<ArchivePage />} />
              <Route path="/modelos" element={<ModelsPage />} />
              <Route path="/metodologia" element={<MethodologyPage />} />
              <Route path="/semana/:weekId" element={<WeeklyRoute />} />
              <Route path="/:date" element={<DateRoute><EditionPage /></DateRoute>} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ReaderErrorBoundary>
        </main>
        <Colophon />
      </div>
    </div>
  );
}

export default App;
