import { useState } from 'react';
import {
  Clapperboard,
  ExternalLink,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function mapFirebaseAuthError(err: unknown): { message: string; isOperationNotAllowed: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('auth/operation-not-allowed')) {
    return {
      message:
        'El acceso con correo y contraseña aún no está habilitado en Firebase Console. Activa Email/Password en Authentication > Sign-in method o entra ahora con Google o con el Perfil Administrador.',
      isOperationNotAllowed: true,
    };
  }
  if (raw.includes('auth/email-already-in-use')) {
    return {
      message: 'Ya existe una cuenta registrada con este correo electrónico.',
      isOperationNotAllowed: false,
    };
  }
  if (raw.includes('auth/invalid-credential') || raw.includes('auth/wrong-password')) {
    return {
      message: 'Correo o contraseña incorrectos.',
      isOperationNotAllowed: false,
    };
  }
  if (raw.includes('auth/user-not-found')) {
    return {
      message: 'No existe ninguna cuenta asociada a ese correo.',
      isOperationNotAllowed: false,
    };
  }
  if (raw.includes('auth/weak-password')) {
    return {
      message: 'La contraseña debe tener al menos 6 caracteres.',
      isOperationNotAllowed: false,
    };
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return {
      message: 'Se cerró la ventana de Google antes de completar el acceso.',
      isOperationNotAllowed: false,
    };
  }
  if (raw.includes('auth/popup-blocked')) {
    return {
      message:
        'El navegador bloqueó la ventana emergente de Google. Permite ventanas emergentes o entra con el Perfil Administrador.',
      isOperationNotAllowed: false,
    };
  }
  if (raw.includes('auth/too-many-requests')) {
    return {
      message: 'Demasiados intentos recientes. Espera unos minutos e inténtalo de nuevo.',
      isOperationNotAllowed: false,
    };
  }
  return {
    message: raw || 'No se pudo completar la autenticación.',
    isOperationNotAllowed: false,
  };
}

export function AuthGate() {
  const {
    user,
    isVerified,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    signInAsAdmin,
    resendVerificationEmail,
    refreshAuthUser,
    logout,
  } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdminRecovery, setShowAdminRecovery] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleGoogle() {
    setBusy(true);
    setError(null);
    setShowAdminRecovery(false);
    setNotice(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
      setShowAdminRecovery(mapped.isOperationNotAllowed);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminAccess() {
    setBusy(true);
    setError(null);
    setShowAdminRecovery(false);
    setNotice(null);
    try {
      await signInAsAdmin({
        email: email.trim() || 'compuappscolombia@gmail.com',
        displayName: displayName.trim() || 'Administrador AUTEUR',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión de Administrador.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setShowAdminRecovery(false);
    setNotice(null);

    if (!email.trim() || !password) {
      setError('Completa tu correo electrónico y contraseña.');
      return;
    }
    if (mode === 'register' && displayName.trim().length < 2) {
      setError('Indica tu nombre profesional o de director.');
      return;
    }

    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail({ displayName, email, password });
        setNotice(
          'Cuenta creada. Enviamos un enlace de verificación a tu correo para habilitar el acceso al estudio.'
        );
      }
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
      setShowAdminRecovery(mapped.isOperationNotAllowed);
    } finally {
      setBusy(false);
    }
  }

  async function handleResend() {
    setBusy(true);
    setError(null);
    try {
      await resendVerificationEmail();
      setNotice('Correo de verificación reenviado. Revisa tu bandeja de entrada.');
    } catch (err) {
      setError(mapFirebaseAuthError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckVerified() {
    setBusy(true);
    setError(null);
    try {
      const ok = await refreshAuthUser();
      if (!ok) {
        setNotice('Tu correo aún aparece pendiente de verificación.');
      }
    } catch (err) {
      setError(mapFirebaseAuthError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0B0B0E] text-[#F2F0EB] flex flex-col justify-between px-4 py-8 sm:px-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 shrink-0">
          <Clapperboard className="w-5 h-5 text-[#E5A93C] shrink-0" />
          <span className="font-display text-lg font-bold tracking-tight text-[#F2F0EB] whitespace-nowrap">
            AUTEUR Studio
          </span>
        </div>
        <span className="hidden sm:inline text-xs font-mono-tech text-[#8D8981] whitespace-nowrap">
          Dirección Cinematográfica · Perfil Director y Administrador
        </span>
      </header>

      <main className="max-w-5xl w-full mx-auto my-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left Editorial Introduction */}
        <section className="lg:col-span-6 space-y-5">
          <p className="text-xs font-mono-tech text-[#E5A93C]">
            Estudio de Dirección y Producción Cinematográfica
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#F2F0EB] leading-tight text-balance">
            Inicia sesión para dirigir producciones o entrenar al Agente Director.
          </h1>
          <p className="text-sm sm:text-[15px] text-[#B8B3AA] leading-relaxed max-w-[54ch]">
            Accede como Director con Google o entra con el <strong className="text-[#F2F0EB]">Perfil Administrador</strong>{' '}
            para auditar las secuencias generadas, inspeccionar los prompts internos del Agente y
            enseñarle criterios cinematográficos permanentes.
          </p>

          <dl className="pt-4 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <dt className="font-semibold text-[#F2F0EB]">Perfil Administrador</dt>
              <dd className="text-[#8D8981] mt-1">
                Acceso inmediato al Laboratorio del Agente para evaluar coherencia, cargar casos de
                auditoría y definir directivas maestras.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[#F2F0EB]">Producción continua</dt>
              <dd className="text-[#8D8981] mt-1">
                Guiones técnicos, planos de cámara, voces en off, storyboards automáticos en 4 frames
                y tráilers de 30s.
              </dd>
            </div>
          </dl>
        </section>

        {/* Right Authentication Panel */}
        <section
          aria-labelledby="auth-gate-title"
          className="lg:col-span-6 w-full max-w-md mx-auto rounded-xl border border-white/12 bg-[#121218] overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-white/10">
            <h2 id="auth-gate-title" className="font-display text-lg font-semibold text-[#F2F0EB]">
              {user && !isVerified
                ? 'Verifica tu correo electrónico'
                : mode === 'login'
                  ? 'Acceso a AUTEUR Studio'
                  : 'Registrar nueva cuenta'}
            </h2>
            <p className="text-xs text-[#8D8981] mt-0.5">
              {user && !isVerified
                ? 'Confirma tu cuenta para habilitar el acceso al espacio de trabajo.'
                : 'Elige acceso directo de Administrador, Google o credenciales registradas.'}
            </p>
          </div>

          <div className="p-6 space-y-5">
            {user && !isVerified ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-white/10 bg-[#0B0B0E] space-y-1.5">
                  <div className="text-sm font-semibold text-[#F2F0EB]">
                    {user.displayName || 'Director AUTEUR'}
                  </div>
                  <div className="text-xs font-mono-tech text-[#9A968E]">{user.email}</div>
                  <div className="pt-1 flex items-center gap-2 text-xs text-[#E5A93C]">
                    <MailCheck className="w-3.5 h-3.5" />
                    <span>Verificación de correo pendiente</span>
                  </div>
                </div>

                <p className="text-xs text-[#C8C3BA] leading-relaxed">
                  Abre el enlace de confirmación enviado a{' '}
                  <span className="font-mono-tech text-[#F2F0EB]">{user.email}</span> y luego
                  pulsa &ldquo;Ya verifiqué mi correo&rdquo;.
                </p>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleCheckVerified}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] text-[#0B0B0E] text-xs font-semibold disabled:opacity-60"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Ya verifiqué mi correo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={busy}
                    className="px-4 py-2 rounded-lg border border-white/12 text-xs font-medium text-[#E6E2DA] hover:bg-white/5 disabled:opacity-60"
                  >
                    Reenviar correo
                  </button>
                </div>

                {notice && (
                  <div className="rounded-lg border border-[#38B2AC]/35 bg-[#122625] px-3 py-2 text-xs text-[#A7F3D0]">
                    {notice}
                  </div>
                )}

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-3 py-2 text-xs text-[#FCA5A5]"
                  >
                    {error}
                  </div>
                )}

                <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[11px] text-[#8D8981]">
                    ¿Prefieres entrar como Administrador?
                  </span>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="text-xs font-medium text-[#FCA5A5] hover:underline"
                  >
                    Cerrar sesión / Cambiar cuenta
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Perfil Administrador Card */}
                <div className="rounded-xl border border-[#E5A93C]/45 bg-[#1B1710] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#F2F0EB]">
                        <UserCog className="w-4 h-4 text-[#E5A93C] shrink-0" />
                        <span>Perfil Administrador · Análisis y Entrenamiento</span>
                      </div>
                      <p className="text-[11px] text-[#C8C3BA] mt-1 leading-relaxed">
                        Ingresa sin bloqueos para auditar el Agente Director, evaluar sus guiones y
                        enseñarle directivas cinematográficas permanentes.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAdminAccess}
                    disabled={busy}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#E5A93C] hover:bg-[#EDA949] disabled:opacity-60 text-[#0B0B0E] text-xs font-semibold transition-colors"
                  >
                    <UserCog className="w-4 h-4 shrink-0" />
                    <span>{busy ? 'Conectando...' : 'Entrar como Administrador'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-lg border border-white/20 bg-[#1B1B24] hover:bg-[#252532] disabled:opacity-60 text-xs font-semibold text-[#F2F0EB] transition-colors"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.8-5.4 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-2H12z"
                    />
                    <path
                      fill="#34A853"
                      d="M3.6 7.5l3.2 2.3C7.7 7.6 9.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 8.3 2.5 5.1 4.6 3.6 7.5z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M12 21.5c2.6 0 4.8-.9 6.4-2.3l-3-2.5c-.8.6-1.9 1-3.4 1-3.8 0-5.2-2.5-5.4-3.7l-3.2 2.5c1.5 3 4.7 5 8.6 5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M21.1 12.2c0-.6-.1-1.1-.2-2H12v3.9h5.4c-.3 1.4-1.1 2.4-2 3l3 2.5c1.8-1.6 2.7-4.1 2.7-7.4z"
                    />
                  </svg>
                  <span>Continuar con Google (Registro / Acceso)</span>
                </button>

                <div className="flex items-center gap-3 text-[11px] text-[#7D7971]">
                  <div className="h-px flex-1 bg-white/10" />
                  <span>o accede con correo Firebase</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                <div
                  role="tablist"
                  aria-label="Modo de acceso"
                  className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#09090C] border border-white/10"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'login'}
                    onClick={() => {
                      setMode('login');
                      setError(null);
                      setShowAdminRecovery(false);
                      setNotice(null);
                    }}
                    className={`py-2 rounded-md text-xs font-medium ${
                      mode === 'login'
                        ? 'bg-[#23232E] text-[#F2F0EB] border border-[#E5A93C]/35'
                        : 'text-[#8D8981] hover:text-[#E6E2DA] border border-transparent'
                    }`}
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'register'}
                    onClick={() => {
                      setMode('register');
                      setError(null);
                      setShowAdminRecovery(false);
                      setNotice(null);
                    }}
                    className={`py-2 rounded-md text-xs font-medium ${
                      mode === 'register'
                        ? 'bg-[#23232E] text-[#F2F0EB] border border-[#E5A93C]/35'
                        : 'text-[#8D8981] hover:text-[#E6E2DA] border border-transparent'
                    }`}
                  >
                    Registrarse
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-3.5">
                  {mode === 'register' && (
                    <div>
                      <label
                        htmlFor="gate-display-name"
                        className="block text-xs font-medium text-[#C8C3BA] mb-1"
                      >
                        Nombre del productor / director
                      </label>
                      <input
                        id="gate-display-name"
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="Ej: Elena Morales"
                        className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="gate-email"
                      className="block text-xs font-medium text-[#C8C3BA] mb-1"
                    >
                      Correo electrónico
                    </label>
                    <input
                      id="gate-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="director@estudio.com"
                      className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="gate-password"
                      className="block text-xs font-medium text-[#C8C3BA] mb-1"
                    >
                      Contraseña
                    </label>
                    <input
                      id="gate-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full rounded-lg border border-white/12 bg-[#0B0B0E] px-3 py-2 text-xs text-[#F2F0EB] placeholder:text-[#6E6A63] focus:border-[#E5A93C] focus:outline-none"
                    />
                  </div>

                  {notice && (
                    <div className="rounded-lg border border-[#38B2AC]/35 bg-[#122625] px-3 py-2 text-xs text-[#A7F3D0]">
                      {notice}
                    </div>
                  )}

                  {error && (
                    <div
                      role="alert"
                      className="rounded-lg border border-[#EF4444]/35 bg-[#3B1515]/50 px-3 py-2.5 text-xs text-[#FCA5A5] leading-relaxed space-y-2.5"
                    >
                      <div className="flex items-start gap-2">
                        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#FCA5A5]" />
                        <span>{error}</span>
                      </div>
                      {showAdminRecovery && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/10">
                          <button
                            type="button"
                            onClick={handleAdminAccess}
                            className="px-3 py-1.5 rounded-md bg-[#E5A93C] text-[#0B0B0E] font-semibold text-[11px]"
                          >
                            Entrar ahora como Administrador
                          </button>
                          <a
                            href="https://console.firebase.google.com/project/pelagic-cat-405307/authentication/providers"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-[#F2F0EB] underline"
                          >
                            <span>Habilitar Email/Password en Firebase</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-2.5 px-4 rounded-lg border border-white/15 bg-[#191922] hover:bg-[#23232E] disabled:opacity-60 text-[#F2F0EB] text-xs font-semibold transition-colors"
                  >
                    {busy
                      ? 'Procesando...'
                      : mode === 'login'
                        ? 'Entrar con correo'
                        : 'Registrar cuenta'}
                  </button>
                </form>

                <div className="pt-2 border-t border-white/10 flex items-center gap-2 text-[11px] text-[#8D8981]">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#38B2AC] shrink-0" />
                  <span>
                    Usa el Perfil Administrador arriba para analizar y entrenar al agente de forma inmediata.
                  </span>
                </div>
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-[11px] text-[#6E6A63]">
        AUTEUR Studio · Producción y Dirección Cinematográfica
      </footer>
    </div>
  );
}
