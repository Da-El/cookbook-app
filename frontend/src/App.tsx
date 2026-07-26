import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TabBar } from './components/TabBar/TabBar';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Auth } from './pages/Auth';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { IngredientDetail } from './pages/IngredientDetail';
import { Placeholder } from './pages/Placeholder';

const queryClient = new QueryClient();

function Shell() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Auth />;

  return (
    <>
      <div style={{ paddingBottom: 72 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/ingredients/:id" element={<IngredientDetail />} />
          <Route path="/create" element={<Placeholder title="Create" />} />
          <Route path="/cookbook" element={<Placeholder title="Your Cookbook" />} />
        </Routes>
      </div>
      <TabBar />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
