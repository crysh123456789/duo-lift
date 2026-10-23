/** Maps Supabase Auth and claim RPC errors to Spanish copy. */

export function authErrorMessage(
  error: { message?: string; code?: string } | null | undefined,
  mode: "login" | "signup",
): string {
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
  if (
    code === "weak_password" ||
    message.includes("at least") ||
    message.includes("too short") ||
    message.includes("password should")
  ) {
    return "La contraseña es demasiado corta. Mínimo 8 caracteres.";
  }
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

export function claimErrorMessage(error: { message?: string } | null | undefined): string {
  const message = error?.message ?? "";
  if (message.includes("already_claimed")) return "Ese historial ya lo trajo otra cuenta.";
  if (message.includes("already_decided")) return "Ya elegiste. No se puede cambiar.";
  if (message.includes("not_authenticated")) return "La sesión caducó. Entra de nuevo.";
  if (message.includes("invalid_history")) return "Ese historial no existe.";
  return "No se pudo traer el historial.";
}
