import { cookies } from "next/headers";
import { DEMO_COOKIE_NAME, validateDemoSession } from "./demo";

/**
 * Resolve the demo session for the current request.
 * Returns true only when demo mode is enabled AND the request cookie holds a
 * valid demo token. Server components only — middleware uses the lightweight
 * presence check in lib/demo instead (edge runtime has no shared memory).
 */
export async function getDemoSession(): Promise<boolean> {
  const jar = await cookies();
  return validateDemoSession(jar.get(DEMO_COOKIE_NAME)?.value);
}
