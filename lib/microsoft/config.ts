export type MicrosoftConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  userEmail: string;
  sharePointSite: string;
  sharePointDefaultFolder: string;
};

export function getMicrosoftConfig(): MicrosoftConfig | null {
  const tenantId = process.env.MS_TENANT_ID?.trim();
  const clientId = process.env.MS_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_CLIENT_SECRET?.trim();
  const userEmail = process.env.MS_USER_EMAIL?.trim();

  if (!tenantId || !clientId || !clientSecret || !userEmail) {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    userEmail,
    sharePointSite:
      process.env.MS_SHAREPOINT_SITE?.trim() ||
      "4studentlives.sharepoint.com:/sites/4SLTechProjects",
    sharePointDefaultFolder:
      process.env.MS_SHAREPOINT_DEFAULT_FOLDER?.trim() || "Dev Docs",
  };
}

export function isMicrosoftConfigured(): boolean {
  return getMicrosoftConfig() !== null;
}
