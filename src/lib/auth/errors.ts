import { MIN_PASSWORD_LENGTH } from "./constants";

/** Maps Supabase Auth and claim RPC errors to Spanish copy. */

export const PASSWORD_TOO_SHORT = "La contraseña es demasiado corta. Mínimo 8 caracteres.";
export const PASSWORDS_DO_NOT_MATCH = "Las contraseñas no coinciden.";
export const FORGOT_SUCCESS_MESSAGE = "Si hay cuenta con ese correo, te enviamos un enlace.";
export const EMAIL_RATE_LIMIT_MESSAGE = "Espera un momento y vuelve a intentar";
/** Short UI pause after Supabase refuses another recovery email. The button enables again on its own. */
export const EMAIL_RATE_LIMIT_COOLDOWN_SECONDS = 5;
export const RECOVERY_LINK_INVALID = "El enlace caducó o no es válido. Pide uno nuevo.";
export const RECOVERY_LINK_FAILED = "No se pudo comprobar el enlace. Inténtalo de nuevo.";

type AuthErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

export function authErrorMessage(error: AuthErrorLike, mode: "login" | "signup"): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (
    code === "user_already_exists" ||
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("user already")
  ) {
    return "Ese correo ya tiene cuenta.";
  }
  if (isWeakPassword(error)) return PASSWORD_TOO_SHORT;
  if (
    mode === "login" &&
    (code === "invalid_credentials" ||
      message.includes("invalid login") ||
      message.includes("invalid credentials"))
  ) {
    return "Correo o contraseña incorrectos.";
  }
  if (message.includes("invalid") && message.includes("email")) return "Revisa el correo.";
  return mode === "signup" ? "No se pudo crear la cuenta." : "No se pudo entrar.";
}

export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return PASSWORD_TOO_SHORT;
  if (password !== confirm) return PASSWORDS_DO_NOT_MATCH;
  return null;
}

export type ForgotOutcome = { ok: true } | { ok: false; message: string; cooldownSeconds: number };

/**
 * Same success for a missing account and a real one.
 * Rate limits and invalid addresses are the only answers that differ.
 */
export function forgotOutcome(error: AuthErrorLike): ForgotOutcome {
  if (!error || isHiddenAccount(error)) return { ok: true };
  if (isRateLimited(error)) {
    return {
      ok: false,
      message: EMAIL_RATE_LIMIT_MESSAGE,
      cooldownSeconds: EMAIL_RATE_LIMIT_COOLDOWN_SECONDS,
    };
  }
  if (isBadEmail(error)) return { ok: false, message: "Revisa el correo.", cooldownSeconds: 0 };
  return { ok: false, message: "No se pudo enviar el enlace.", cooldownSeconds: 0 };
}

export function passwordUpdateMessage(error: AuthErrorLike): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (
    code === "same_password" ||
    message.includes("should be different") ||
    message.includes("same password")
  ) {
    return "Elige una contraseña distinta a la anterior.";
  }
  if (isWeakPassword(error)) return PASSWORD_TOO_SHORT;
  if (
    code === "session_not_found" ||
    code === "session_expired" ||
    message.includes("session missing") ||
    message.includes("auth session missing") ||
    message.includes("session not found")
  ) {
    return RECOVERY_LINK_INVALID;
  }
  return "No se pudo guardar la contraseña.";
}

function isWeakPassword(error: AuthErrorLike): boolean {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  if (message.includes("different") || message.includes("same password")) return false;
  return (
    code === "weak_password" ||
    message.includes("at least") ||
    message.includes("too short") ||
    message.includes("password should")
  );
}

function isRateLimited(error: AuthErrorLike): boolean {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("only request this")
  );
}

function isBadEmail(error: AuthErrorLike): boolean {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    code === "email_address_invalid" ||
    code === "validation_failed" ||
    (message.includes("invalid") && message.includes("email")) ||
    message.includes("unable to validate email")
  );
}

function isHiddenAccount(error: AuthErrorLike): boolean {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();
  return (
    code === "user_not_found" ||
    code === "email_not_found" ||
    message.includes("user not found") ||
    message.includes("email not found") ||
    message.includes("no user found")
  );
}

export function claimErrorMessage(error: { message?: string } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.includes("already_claimed")) return "Ese historial ya lo trajo otra cuenta.";
  if (message.includes("already_decided")) return "Ya elegiste. No se puede cambiar.";
  if (message.includes("not_authenticated")) return "La sesión caducó. Entra de nuevo.";
  if (message.includes("invalid_history")) return "Ese historial no existe.";
  return "No se pudo traer el historial.";
}
