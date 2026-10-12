type AuthErrorShape = { message?: string; status?: number } | null;
type AuthUserShape = {
  id: string;
  phone?: string;
  phone_confirmed_at?: string;
} | null;

export interface CompatibleAuthClient {
  getUser(jwt?: string): Promise<{
    data: { user: AuthUserShape };
    error: AuthErrorShape;
  }>;
  signOut(options?: { scope?: "global" | "local" | "others" }): Promise<{
    error: AuthErrorShape;
  }>;
  signInWithPassword(credentials: {
    email: string;
    password: string;
  }): Promise<{ data: unknown; error: AuthErrorShape }>;
  signInWithOtp(credentials: {
    phone: string;
    options?: {
      shouldCreateUser?: boolean;
      captchaToken?: string;
    };
  }): Promise<{ data: unknown; error: AuthErrorShape }>;
  verifyOtp(credentials: {
    phone: string;
    token: string;
    type: "sms";
  }): Promise<{
    data: { user: AuthUserShape };
    error: AuthErrorShape;
  }>;
}

/** Work around supabase-js 2.117's bundled type losing inherited auth methods. */
export const compatibleAuth = <T extends { auth: unknown }>(client: T) =>
  client as Omit<T, "auth"> & { auth: CompatibleAuthClient };
