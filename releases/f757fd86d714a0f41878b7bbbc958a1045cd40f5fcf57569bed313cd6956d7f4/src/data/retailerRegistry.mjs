import {
  RETAILER_IDENTITY_STATE,
  RETAILER_PRESENCE,
  RETAILER_REGISTRY_META,
  createRetailerIdentityRegistry
} from "./retailers/identityContract.mjs";
import { RETAILER_IDENTITY_PACKETS } from "./retailers/index.mjs";

export {
  RETAILER_IDENTITY_STATE,
  RETAILER_PRESENCE,
  RETAILER_REGISTRY_META
};

export const RETAILER_IDENTITIES = createRetailerIdentityRegistry(
  RETAILER_IDENTITY_PACKETS
);

const RETAILER_BY_ID = new Map(
  RETAILER_IDENTITIES.map((retailer) => [retailer.id, retailer])
);

export function getRetailerIdentity(retailerId) {
  if (typeof retailerId !== "string") return null;
  return RETAILER_BY_ID.get(retailerId) ?? null;
}
