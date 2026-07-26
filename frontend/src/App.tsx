import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ToastProvider } from './components/Toast/ToastContext';
import { Shell } from './components/Shell/Shell';
import { Auth } from './pages/Auth';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { IngredientDetail } from './pages/IngredientDetail';
import { Placeholder } from './pages/Placeholder';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function Shelled({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Auth />;

  return (
    <Routes>
      <Route path="/" element={<Shelled><Home /></Shelled>} />
      <Route path="/browse" element={<Shelled><Browse /></Shelled>} />
      <Route path="/create" element={<Shelled><Placeholder title="Create" /></Shelled>} />
      <Route path="/cookbook" element={<Shelled><Placeholder title="Your Cookbook" /></Shelled>} />
      <Route path="/ingredients/:id" element={<IngredientDetail />} />
      <Route path="/meals/:id" element={<Placeholder title="Meal" />} />
      <Route path="/chefs/:id" element={<Placeholder title="Chef" />} />
      <Route path="/settings" element={<Placeholder title="Settings" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Routed />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
