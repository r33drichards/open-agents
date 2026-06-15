import { checkBotId } from "botid/server";

/**
 * Shared Vercel BotID server-side configuration.
 *
 * `extraAllowedHosts` tells BotID which frontend origins are permitted to
 * call the protected endpoints — anything on our own domains plus Vercel
 * preview / sandbox URLs.
 */
export const botIdConfig = {
  advancedOptions: {
    extraAllowedHosts: [
      "vercel.com",
      "*.vercel.com",
      "*.vercel.dev",
      "*.vercel.run",
      "*.open-agents.dev",
    ],
  },
};

export async function checkBotProtection() {
  // Bypass in non-production, or when explicitly opted in via `BOTID_DISABLED`.
  // The latter exists only for running a local production build (`next start`)
  // where Vercel's bot-protection API and OIDC token are unavailable, so
  // `checkBotId()` throws. This must never be set in a real deployment.
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.BOTID_DISABLED === "true"
  ) {
    return {
      isHuman: true,
      isBot: false,
      isVerifiedBot: false,
      bypassed: true,
    };
  }

  return checkBotId(botIdConfig);
}
