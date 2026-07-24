// Emulator validation for ../firestore.rules.hardened
//
// Run with:   cd firestore-tests && npm install && npm test
// Requires:   Java 21+ (current Firebase CLI needs JDK >= 21 for the emulator)
//             and the Firebase CLI on PATH.
//
// This both COMPILES the hardened rules (the emulator rejects invalid syntax on
// load) and asserts the key allow/deny behaviors. Exits non-zero on any failure.

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

// E.164 auth identities and the matching digits-only ids stored on docs.
const OWNER_PHONE = "+14022039987";
const OWNER_DIGITS = "14022039987";
const OTHER_PHONE = "+14155550000";
const ZIP = "11743";
const PROVIDER_ID = `${OWNER_DIGITS}_${ZIP}`;

function ctx(env, phone) {
  // phone_number custom claim mirrors what Firebase phone-auth puts on the token.
  return env.authenticatedContext(phone, { phone_number: phone }).firestore();
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-foodyzz",
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
    },
  });

  // Admin = the `admin:true` custom claim (no phone_number), like the real
  // email-authed admin after the claim was set.
  const adminCtx = env.authenticatedContext("admin-uid", { admin: true }).firestore();

  let failures = 0;
  const check = async (label, p) => {
    try {
      await p;
      console.log(`  ✓ ${label}`);
    } catch (e) {
      failures++;
      console.error(`  ✗ ${label} — ${e.message}`);
    }
  };

  // Seed data bypassing rules.
  await env.withSecurityRulesDisabled(async (admin) => {
    const db = admin.firestore();
    await db.doc(`providers/${PROVIDER_ID}`).set({ phoneNumber: OWNER_DIGITS, zipCode: ZIP, onboarded: true, bankAccount: { routingNumber: "x" } });
    await db.doc(`orders/order_1`).set({ customerPhone: OWNER_PHONE, status: "requested", providerId: PROVIDER_ID, createdAt: new Date().toISOString() });
    // Provider-safe mirror (customer charge fields stripped) — what scrubsHQ reads.
    await db.doc(`providerOrders/order_1`).set({ customerPhone: OWNER_PHONE, status: "requested", providerId: PROVIDER_ID, createdAt: new Date().toISOString() });
    // Provider-payout ledger — admin-readable, server-only writes.
    await db.doc(`payouts/payout_1`).set({ providerId: PROVIDER_ID, amount: 10, status: "paid" });
  });

  const owner = ctx(env, OWNER_PHONE);
  const other = ctx(env, OTHER_PHONE);

  console.log("providers:");
  await check("owner can update own provider doc",
    assertSucceeds(owner.doc(`providers/${PROVIDER_ID}`).update({ businessName: "Mine" })));
  await check("NON-owner CANNOT overwrite provider bank details",
    assertFails(other.doc(`providers/${PROVIDER_ID}`).update({ bankAccount: { routingNumber: "stolen" } })));
  await check("owner can create a provider doc carrying their phone",
    assertSucceeds(owner.doc(`providers/${OWNER_DIGITS}_10001`).set({ phoneNumber: OWNER_DIGITS, zipCode: "10001", onboarded: false })));
  await check("anyone authed can READ providers (browse)",
    assertSucceeds(other.doc(`providers/${PROVIDER_ID}`).get()));

  console.log("orders:");
  await check("customer can create their own order",
    assertSucceeds(owner.doc("orders/order_2").set({ customerPhone: OWNER_PHONE, status: "requested", providerId: PROVIDER_ID, createdAt: new Date().toISOString() })));
  await check("customer CANNOT create an order spoofing another customer",
    assertFails(owner.doc("orders/order_3").set({ customerPhone: OTHER_PHONE, status: "requested", providerId: PROVIDER_ID, createdAt: new Date().toISOString() })));
  await check("a provider (non-customer) can still UPDATE order status (dispatch flow)",
    assertSucceeds(other.doc("orders/order_1").update({ status: "confirmed" })));
  // Orders carry the customer's charge/authorization amounts → read is now restricted
  // to the owning customer or admin. Providers must read the redacted providerOrders
  // mirror instead (asserted below), never the raw order.
  await check("customer can READ their OWN order",
    assertSucceeds(owner.doc("orders/order_1").get()));
  await check("a provider/other customer CANNOT read someone else's order (charge data hidden)",
    assertFails(other.doc("orders/order_1").get()));

  console.log("providerOrders (provider-safe mirror — charge fields stripped):");
  await check("any authed user can READ providerOrders (the broadcast/dispatch feed)",
    assertSucceeds(other.doc("providerOrders/order_1").get()));
  await check("clients CANNOT write providerOrders (server-maintained mirror)",
    assertFails(other.doc("providerOrders/order_1").set({ status: "hacked" }, { merge: true })));

  console.log("admin (email login, admin:true claim, no phone):");
  await check("admin CAN read any customer order",
    assertSucceeds(adminCtx.doc("orders/order_1").get()));
  await check("admin can write any provider doc (block flag / bank edits)",
    assertSucceeds(adminCtx.doc(`providers/${PROVIDER_ID}`).update({ isBlocked: true })));
  await check("admin can write a user doc (block flag)",
    assertSucceeds(adminCtx.doc(`users/${OWNER_DIGITS}`).set({ isBlocked: true }, { merge: true })));
  await check("admin can update an order",
    assertSucceeds(adminCtx.doc("orders/order_1").update({ adminNote: "x" })));

  console.log("negative control (no auth):");
  const anon = env.unauthenticatedContext().firestore();
  await check("unauthenticated CANNOT read providers",
    assertFails(anon.doc(`providers/${PROVIDER_ID}`).get()));

  console.log("config & secrets:");
  await check("anyone (even unauth) can READ public apiConfig/global",
    assertSucceeds(anon.doc("apiConfig/global").get()));
  await check("client CANNOT write apiConfig/global",
    assertFails(owner.doc("apiConfig/global").set({ hacked: true }, { merge: true })));
  await check("client CANNOT READ apiConfigSecret (Stripe secret key)",
    assertFails(owner.doc("apiConfigSecret/stripe").get()));
  await check("client CANNOT WRITE apiConfigSecret",
    assertFails(owner.doc("apiConfigSecret/stripe").set({ secretKey: "x" })));
  await check("even an admin CANNOT read apiConfigSecret (functions-only)",
    assertFails(adminCtx.doc("apiConfigSecret/stripe").get()));

  console.log("salesTaxByZip:");
  await check("anyone can READ the tax table",
    assertSucceeds(anon.doc(`salesTaxByZip/${ZIP}`).get()));
  await check("client CANNOT write the tax table (server-only)",
    assertFails(owner.doc(`salesTaxByZip/${ZIP}`).set({ taxRate: 0 })));

  console.log("users (self-only writes):");
  await check("owner can write their OWN user doc",
    assertSucceeds(owner.doc(`users/${OWNER_PHONE}`).set({ name: "Me" }, { merge: true })));
  await check("user CANNOT write ANOTHER user's doc",
    assertFails(other.doc(`users/${OWNER_PHONE}`).set({ name: "Hacked" }, { merge: true })));

  console.log("providers (cannot spoof another phone):");
  await check("cannot create a provider doc carrying ANOTHER phone",
    assertFails(owner.doc(`providers/14999999999_10001`).set({ phoneNumber: "14999999999", zipCode: "10001", onboarded: false })));

  console.log("messages & archived users:");
  await check("any authed user can create an order chat message",
    assertSucceeds(owner.doc("messages/msg_1").set({ orderId: "order_1", senderRole: "customer", text: "hi" })));
  await check("unauthenticated CANNOT create a message",
    assertFails(anon.doc("messages/msg_2").set({ text: "x" })));
  await check("owner can archive ONLY their own user record",
    assertSucceeds(owner.doc(`archivedUsers/${OWNER_PHONE}`).set({ phoneNumber: OWNER_PHONE })));
  await check("user CANNOT archive someone else's record",
    assertFails(other.doc(`archivedUsers/${OWNER_PHONE}`).set({ phoneNumber: OWNER_PHONE })));

  console.log("default-deny (unlisted server-only collections):");
  await check("providerPerformance is denied to clients",
    assertFails(owner.doc(`providerPerformance/${PROVIDER_ID}`).get()));
  await check("payouts is denied to clients",
    assertFails(owner.doc("payouts/payout_1").get()));
  await check("admin CAN read the provider-payouts ledger",
    assertSucceeds(adminCtx.doc("payouts/payout_1").get()));
  await check("clients CANNOT write the payouts ledger (server-only)",
    assertFails(owner.doc("payouts/payout_1").set({ amount: 9999 }, { merge: true })));
  await check("providerCancellations is denied to clients",
    assertFails(owner.doc(`providerCancellations/${PROVIDER_ID}`).get()));

  await env.cleanup();
  if (failures) { console.error(`\n${failures} rule assertion(s) FAILED`); process.exit(1); }
  console.log("\nAll rule assertions passed. Hardened rules compiled and behaved as expected.");
})().catch((e) => { console.error(e); process.exit(1); });
