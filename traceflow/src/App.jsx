import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ScrollToTop from './components/ScrollToTop';
import { LanguageProvider } from '@/lib/i18n';
import AppLayout from '@/components/AppLayout';
import Overview from '@/pages/Overview';
import DataQuality from '@/pages/DataQuality';
import Transport from '@/pages/Transport';
import RawMaterials from '@/pages/RawMaterials';
import Traceability from '@/pages/Traceability';
import Sustainability from '@/pages/Sustainability';
import Farms from '@/pages/Farms';
import FarmDetail from '@/pages/FarmDetail';
import Reports from '@/pages/Reports';
import Automations from '@/pages/Automations';
import Settings from '@/pages/Settings';
import Demo from '@/pages/Demo';
import DataPlatform from '@/pages/DataPlatform';
import Nature from '@/pages/Nature';
import Actions from '@/pages/Actions';

// Local, single-user prototype: every page is reachable directly, with no login or role gate.
function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <LanguageProvider>
        <Router>
          <ScrollToTop />
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Overview />} />
              <Route path="/data-quality" element={<DataQuality />} />
              <Route path="/transport" element={<Transport />} />
              <Route path="/raw-materials" element={<RawMaterials />} />
              <Route path="/traceability" element={<Traceability />} />
              <Route path="/sustainability" element={<Sustainability />} />
              <Route path="/actions" element={<Actions />} />
              <Route path="/farms" element={<Farms />} />
              <Route path="/farms/:id" element={<FarmDetail />} />
              <Route path="/nature" element={<Nature />} />
              <Route path="/climate" element={<Navigate to="/" replace />} />
              <Route path="/weather" element={<Navigate to="/" replace />} />
              <Route path="/platform" element={<DataPlatform />} />
              <Route path="/forecast" element={<Navigate to="/" replace />} />
              <Route path="/assistant" element={<Navigate to="/data-quality?assist=1" replace />} />
              <Route path="/gemini" element={<Navigate to="/data-quality?assist=1" replace />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/automations" element={<Automations />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/demo" element={<Demo />} />
            </Route>
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
        <Toaster />
      </LanguageProvider>
    </QueryClientProvider>
  )
}

export default App
