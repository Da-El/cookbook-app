import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { ToastProvider } from './components/Toast/ToastContext';
import { InstallProvider } from './pwa/InstallContext';
import { InstallPrompt } from './components/InstallPrompt/InstallPrompt';
import { Shell } from './components/Shell/Shell';
import { Auth } from './pages/Auth';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { Create } from './pages/Create';
import { CreateMeal } from './pages/CreateMeal';
import { CreateIngredient } from './pages/CreateIngredient';
import { Cookbook } from './pages/Cookbook';
import { Customize } from './pages/Customize';
import { IngredientDetail } from './pages/IngredientDetail';
import { MealDetail } from './pages/MealDetail';
import { CookMode } from './pages/CookMode';
import { ChefPage } from './pages/ChefPage';
import { Settings } from './pages/Settings';
import { Legal } from './pages/Legal';
import { Import } from './pages/Import';
import { Plan } from './pages/Plan';
import { Discover } from './pages/Discover';
import { Guides, GuidePage } from './pages/Guides';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function Tab({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}

/** Detail/overlay screens: sidebar persists on desktop, tab bar hides on mobile. */
function Bare({ children }: { children: React.ReactNode }) {
  return <Shell bare>{children}</Shell>;
}

function Routed() {
  const { user, loading } = useAuth();
  if (loading) return null;

  // Legal is the one screen reachable signed-out: a privacy policy you need an
  // account to read isn't much of a privacy policy. Everything else falls
  // through to the sign-in screen.
  if (!user) {
    return (
      <Routes>
        <Route path="/legal" element={<Bare><Legal /></Bare>} />
        <Route path="*" element={<Auth />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Tab><Home /></Tab>} />
      <Route path="/browse" element={<Tab><Browse /></Tab>} />
      <Route path="/create" element={<Tab><Create /></Tab>} />
      <Route path="/cookbook" element={<Tab><Cookbook /></Tab>} />
      <Route path="/discover" element={<Tab><Discover /></Tab>} />
      <Route path="/plan" element={<Tab><Plan /></Tab>} />

      <Route path="/create/meal" element={<Bare><CreateMeal /></Bare>} />
      <Route path="/create/ingredient" element={<Bare><CreateIngredient /></Bare>} />
      <Route path="/cookbook/customize" element={<Bare><Customize /></Bare>} />
      <Route path="/ingredients/:id" element={<Bare><IngredientDetail /></Bare>} />
      <Route path="/meals/:id" element={<Bare><MealDetail /></Bare>} />
      <Route path="/chefs/:id" element={<Bare><ChefPage /></Bare>} />
      <Route path="/settings" element={<Bare><Settings /></Bare>} />
      <Route path="/legal" element={<Bare><Legal /></Bare>} />
      <Route path="/import" element={<Bare><Import /></Bare>} />
      <Route path="/guides" element={<Bare><Guides /></Bare>} />
      <Route path="/guides/:slug" element={<Bare><GuidePage /></Bare>} />

      {/* Full-screen, no chrome on either platform. */}
      <Route path="/meals/:id/cook" element={<CookMode />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <ThemeProvider>
              <InstallProvider>
                <Routed />
                <InstallPrompt />
              </InstallProvider>
            </ThemeProvider>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
