import "server-only";
import { institutions } from "./types";
import { isUuid } from "./client";
export function pluggyConfig(env: Record<string, string | undefined> = process.env) {
  const ownerId = (env.PLUGGY_HUB_USER_ID || env.ORGANIZZE_HUB_USER_ID || "")
    .trim()
    .toLowerCase();
  const clientId = env.PLUGGY_CLIENT_ID || "";
  const clientSecret = env.PLUGGY_CLIENT_SECRET || "";
  const items = institutions.map((bank) => ({
    ...bank,
    itemId: (env[bank.env] || "").trim().toLowerCase(),
  }));
  const ids = items
    .filter((bank) => bank.itemId)
    .map((bank) => bank.itemId.toLowerCase());
  return {
    ownerId,
    clientId,
    clientSecret,
    items: items.map((bank) => ({
      ...bank,
      valid:
        isUuid(bank.itemId) &&
        ids.filter((id) => id === bank.itemId.toLowerCase()).length === 1,
    })),
    credentialsPresent: Boolean(clientId && clientSecret && isUuid(ownerId)),
  };
}
