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

const ADMIN_SESSION_STORAGE_KEY = 'auteur_admin_session_v1';

interface StoredAdminSession {
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
  isLocalDevPreview: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: {
    displayName: string;
    email: string;
    password: string;
  }) => Promise<void>;
  signInAsAdmin: (params?: { email?: string; displayName?: string }) => Promise<void>;
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

function readStoredAdminSession(): StoredAdminSession | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAdminSession>;
    if (parsed && parsed.role === 'admin' && typeof parsed.uid === 'string') {
      return {
        uid: parsed.uid,
        displayName: parsed.displayName || 'Administrador AUTEUR',
        email: parsed.email || 'compuappscolombia@gmail.com',
        role: 'admin',
        emailVerified: true,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLocalDevPreview] = useState<boolean>(() => detectLocalDevPreview());
  const [adminSession, setAdminSession] = useState<StoredAdminSession | null>(() =>
    readStoredAdminSession()
  );
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
  const [loading, setLoading] = useState(
    () => !detectLocalDevPreview() && !readStoredAdminSession()
  );

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
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    setAdminSession(null);
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    if (cred.user && cred.user.emailVerified) {
      await ensureUserProfileInFirestore(cred.user);
    }
  }

  async function signInWithEmail(email: string, password: string) {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    setAdminSession(null);
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
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    setAdminSession(null);
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

  async function signInAsAdmin(params?: { email?: string; displayName?: string }) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params?.email?.trim() || 'compuappscolombia@gmail.com',
        displayName: params?.displayName?.trim() || 'Administrador AUTEUR',
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.session) {
      throw new Error(data.error || 'No se pudo iniciar la sesión de Administrador.');
    }
    const nextAdmin = data.session as StoredAdminSession;
    localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(nextAdmin));
    setAdminSession(nextAdmin);
    setLoading(false);
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
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    setAdminSession(null);
    if (auth.currentUser) {
      await signOut(auth);
    }
  }

  const isAdminSession = Boolean(adminSession);
  const activeUser: User | null = adminSession
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
