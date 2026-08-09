export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  userEmail: string;
  label: string;
};

export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  const userEmail = process.env.GOOGLE_USER_EMAIL?.trim();

  if (!clientId || !clientSecret || !refreshToken || !userEmail) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    refreshToken,
    userEmail,
    label: process.env.GOOGLE_LABEL?.trim() || "personal",
  };
}

export function isGoogleConfigured(): boolean {
  return getGoogleConfig() !== null;
}
