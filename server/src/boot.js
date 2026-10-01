export const MIN_JWT_SECRET_LENGTH = 32;

const HOW_TO_FIX = "Generate one with: openssl rand -base64 32";

/**
 * Throws unless the configuration is safe to serve real traffic with. Called once at boot (index.js),
 * not from createApp, so tests can build apps with throwaway secrets.
 *
 * JWT_SECRET signs sessions and run tickets, so a guessable one lets anyone forge both. The value
 * shipped in .env.example is a 32-character placeholder, so length alone would not catch a verbatim copy.
 * @param {{jwtSecret?: string}} config
 */
export function assertSecureConfig(config) {
  const secret = typeof config?.jwtSecret === "string" ? config.jwtSecret : "";
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET must be set to a random value of at least ${MIN_JWT_SECRET_LENGTH} characters (it signs sessions and run tickets). ${HOW_TO_FIX}`,
    );
  }
  if (/change_me/i.test(secret)) {
    throw new Error(`JWT_SECRET is still the placeholder from .env.example. ${HOW_TO_FIX}`);
  }
}
