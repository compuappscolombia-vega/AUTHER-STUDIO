import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';
import { ensureUserProfileInFirestore } from '../services/firestoreSync';
import type { UserRole } from '../types/studio';

const LEGACY_ADMIN_SESSION_KEY = 'auteur_admin_session_v1';

interface AdminSession {
  uid: string;
  displayName: string;
  email: string;
  role: 'admin';
  emailVerified: true;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isVerified: boolean;
  userRole: UserRole;
  isAdminSession: boolean;
  adminToken: string | null;
  isLocalDevPreview: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: {
    displayName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  signInAsAdmin: (params: { identifier: string; password: string }) => Promise<boolean>;
  resendVerificationEmail: () => Promise<void>;
  refreshAuthUser: () => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function detectLocalDevPreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  if (!isLocalHost) return false;
  return new URLSearchParams(window.location.search).get('autostart') === '1';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLocalDevPreview] = useState<boolean>(() => detectLocalDevPreview());
  // Admin credentials/token live strictly in React memory (never persisted in localStorage)
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(() =>
    detectLocalDevPreview()
      ? ({
          uid: 'dev-preview-director',
          displayName: 'Director Preview',
          email: 'director@auteur.local',
          emailVerified: true,
        } as unknown as User)
      : null
  );
  const [, setAuthRevision] = useState(0);
  const [loading, setLoading] = useState(() => !detectLocalDevPreview());

  useEffect(() => {
    try {
      window.localStorage?.removeItem(LEGACY_ADMIN_SESSION_KEY);
    } catch {
      // Ignore storage access failures
    }
  }, []);

  useEffect(() => {
    if (isLocalDevPreview) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setFirebaseUser(nextUser);
      setLoading(false);
      if (nextUser && nextUser.emailVerified) {
        try {
          await ensureUserProfileInFirestore(nextUser);
        } catch (err) {
          console.error('Error sincronizando perfil de usuario:', err);
        }
      }
    });
    return () => unsubscribe();
  }, [isLocalDevPreview]);

  async function signInWithGoogle() {
    setAdminSession(null);
    setAdminToken(null);
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    if (cred.user && cred.user.emailVerified) {
      await ensureUserProfileInFirestore(cred.user);
    }
  }

  async function signInWithEmail(email: string, password: string) {
    setAdminSession(null);
    setAdminToken(null);
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (cred.user && cred.user.emailVerified) {
      await ensureUserProfileInFirestore(cred.user);
    }
  }

  async function registerWithEmail(params: {
    displayName: string;
    email: string;
    password: string;
  }) {
    setAdminSession(null);
    setAdminToken(null);
    const cred = await createUserWithEmailAndPassword(
      auth,
      params.email.trim(),
      params.password
    );
    await updateProfile(cred.user, {
      displayName: params.displayName.trim(),
    });
    await sendEmailVerification(cred.user);
    setFirebaseUser(cred.user);
    setAuthRevision((r) => r + 1);
  }

  async function signInAsAdmin(params: {
    identifier: string;
    password: string;
  }): Promise<boolean> {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: params.identifier.trim(),
        password: params.password,
      }),
    });
    if (res.status === 401) {
      return false;
    }
    const data = await res.json();
    if (!res.ok || !data.session || !data.token) {
      throw new Error(data.error || 'No se pudo completar la autenticación.');
    }
    setAdminToken(String(data.token));
    setAdminSession(data.session as AdminSession);
    setLoading(false);
    return true;
  }

  async function resendVerificationEmail() {
    if (!auth.currentUser) return;
    await sendEmailVerification(auth.currentUser);
  }

  async function refreshAuthUser(): Promise<boolean> {
    if (!auth.currentUser) return false;
    await reload(auth.currentUser);
    const updated = auth.currentUser;
    setFirebaseUser(updated ?? null);
    setAuthRevision((r) => r + 1);
    if (updated?.emailVerified) {
      await ensureUserProfileInFirestore(updated);
      return true;
    }
    return false;
  }

  async function logout() {
    setAdminSession(null);
    setAdminToken(null);
    if (auth.currentUser) {
      await signOut(auth);
    }
  }

  const isAdminSession = Boolean(adminSession && adminToken);
  const activeUser: User | null =
    isAdminSession && adminSession
      ? ({
          uid: adminSession.uid,
          displayName: adminSession.displayName,
          email: adminSession.email,
          emailVerified: true,
        } as unknown as User)
      : firebaseUser;

  const userRole: UserRole = isAdminSession ? 'admin' : 'director';

  return (
    <AuthContext.Provider
      value={{
        user: activeUser,
        loading,
        isVerified: Boolean(activeUser && (activeUser.emailVerified || isAdminSession)),
        userRole,
        isAdminSession,
        adminToken,
        isLocalDevPreview,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        signInAsAdmin,
        resendVerificationEmail,
        refreshAuthUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  }
  return ctx;
}
