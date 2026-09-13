/**
 * EAC role bitmaps, transcribed from the pinned commit rather than computed at runtime, so a bit value
 * here is checkable by eye against the source it names:
 *   RegistryRolesLib.sol  (github.com/ensdomains/contracts-v2 @ 97a57293f3b4279d94b571e678edb53ce62638f4)
 *   PermissionedResolverLib.sol (same repo, same commit)
 *
 * Each role is one nybble; its admin counterpart is the same bit shifted 128 bits higher
 * (`ROLE_X_ADMIN = ROLE_X << 128`), so an admin bitmap can always be built with `adminOf(...)`.
 */

function adminOf(roleBit: bigint): bigint {
  return roleBit << 128n;
}

// --- RegistryRolesLib (PermissionedRegistry / UserRegistry) ---
export const REGISTRY_ROLES = {
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: (1n << 28n) << 128n, // admin-only bit, no non-admin counterpart
  WAS_RESERVED: 1n << 32n,
  SET_URI: 1n << 36n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
} as const;

/// The bitmap `ETHRegistrar.register()` grants a name's owner on the name's own resource (not root):
/// set-subregistry, set-resolver, and transfer, each with its admin counterpart. Verified by reading
/// `REGISTRATION_ROLE_BITMAP` in ETHRegistrar.sol directly; it is what makes `setSubregistry`/`setResolver`
/// callable by the owner after registering nyaya.eth with placeholder (zero) addresses.
export const ETH_REGISTRAR_GRANTS_OWNER =
  REGISTRY_ROLES.SET_SUBREGISTRY |
  adminOf(REGISTRY_ROLES.SET_SUBREGISTRY) |
  REGISTRY_ROLES.SET_RESOLVER |
  adminOf(REGISTRY_ROLES.SET_RESOLVER) |
  REGISTRY_ROLES.CAN_TRANSFER_ADMIN;

/// What we grant ourselves (the operator) as `rootAccount` when initializing our own UserRegistry proxy.
/// Broad on purpose: this is our subregistry, and root-resource roles cascade to every resource inside it
/// (`_effectiveRoles` ORs in ROOT_RESOURCE unconditionally), so this one grant is what lets the operator
/// register subnames and later change their subregistry/resolver/URI without a second grant per subname.
export const OPERATOR_USER_REGISTRY_ROOT_BITMAP =
  REGISTRY_ROLES.REGISTRAR |
  adminOf(REGISTRY_ROLES.REGISTRAR) |
  REGISTRY_ROLES.SET_SUBREGISTRY |
  adminOf(REGISTRY_ROLES.SET_SUBREGISTRY) |
  REGISTRY_ROLES.SET_RESOLVER |
  adminOf(REGISTRY_ROLES.SET_RESOLVER) |
  REGISTRY_ROLES.RENEW |
  adminOf(REGISTRY_ROLES.RENEW) |
  REGISTRY_ROLES.UNREGISTER |
  adminOf(REGISTRY_ROLES.UNREGISTER) |
  REGISTRY_ROLES.UPGRADE |
  adminOf(REGISTRY_ROLES.UPGRADE) |
  REGISTRY_ROLES.CAN_TRANSFER_ADMIN;

// --- PermissionedResolverLib (PermissionedResolver) ---
export const RESOLVER_ROLES = {
  SET_ADDR: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_PUBKEY: 1n << 12n,
  SET_ABI: 1n << 16n,
  SET_INTERFACE: 1n << 20n,
  SET_NAME: 1n << 24n,
  SET_ALIAS: 1n << 28n,
  CLEAR: 1n << 32n,
  SET_DATA: 1n << 36n,
  CAN_NAME: 1n << 120n,
  UPGRADE: 1n << 124n,
} as const;

/// What we grant the operator as `admin` when initializing our own PermissionedResolver proxy. Holding
/// SET_TEXT_ADMIN at ROOT_RESOURCE means the operator can call `authorizeTextRoles` for ANY node without a
/// separate per-node grant, and holding SET_TEXT (non-admin) at root means the operator can `setText`
/// directly on any node too (`hasRoles` also ORs in ROOT_RESOURCE). Neither privilege is ever given to a
/// juror: a juror's grant below is always scoped to one node and one text-record part.
export const OPERATOR_RESOLVER_ROOT_BITMAP =
  RESOLVER_ROLES.SET_TEXT |
  adminOf(RESOLVER_ROLES.SET_TEXT) |
  RESOLVER_ROLES.SET_ADDR |
  adminOf(RESOLVER_ROLES.SET_ADDR) |
  RESOLVER_ROLES.CLEAR |
  adminOf(RESOLVER_ROLES.CLEAR) |
  RESOLVER_ROLES.SET_ALIAS |
  RESOLVER_ROLES.UPGRADE |
  adminOf(RESOLVER_ROLES.UPGRADE);

/// The text-record keys a juror subname carries. `score`, `returnRate`, `persona`, `casesJudged`,
/// `cumulativeReturnBps`, and `lastCaseId` are all operator-only (the operator never explicitly grants
/// itself SET_TEXT there; ROOT_RESOURCE already covers it, and it cascades automatically to any key,
/// including these four added for the judge-visible demo metadata — no new grant was needed to add them).
/// `profile` and `strategy` are granted to the juror's own key via `authorizeTextRoles`, scoped to exactly
/// that key's EAC "part" (`keccak256(bytes(key))`) on exactly that subname's node — never to
/// `resource(node, 0)`, which would be the "any part of this name" grant and would let the juror write its
/// own score (or these new stats) too.
export const OPERATOR_ONLY_TEXT_KEYS = ["score", "returnRate", "persona", "casesJudged", "cumulativeReturnBps", "lastCaseId"] as const;
export const JUROR_WRITABLE_TEXT_KEYS = ["profile", "strategy"] as const;
