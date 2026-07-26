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
// A second person working the SAME store. Their phone appears nowhere in the
// store's doc id — which is exactly the case the old ownsPhoneField-only rules
// could not express.
const MEMBER_PHONE = "+14155559999";
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

  // A store member: hqStaff, NOT admin. This is the claim syncAdminClaim mints for
  // anyone who belongs to a store, and the whole point of it is that it is weaker.
  const hqStaffCtx = env.authenticatedContext(MEMBER_PHONE, {
    phone_number: MEMBER_PHONE, hqStaff: true,
  }).firestore();

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
    // Store membership — written only by Cloud Functions, and the sole reason a
    // second person can operate a store whose id carries someone else's phone.
    await db.doc(`providers/${PROVIDER_ID}/members/${OWNER_PHONE}`).set({ phone: OWNER_PHONE, role: "owner", addedAt: new Date().toISOString() });
    await db.doc(`providers/${PROVIDER_ID}/members/${MEMBER_PHONE}`).set({ phone: MEMBER_PHONE, role: "staff", addedAt: new Date().toISOString() });
    // A customer with documents on file. Must EXIST: the hqStaff review carve-out
    // is an update rule (it diffs against resource.data), so staff can stamp a
    // review but cannot conjure a customer record that was never there.
    await db.doc(`users/${OTHER_PHONE}`).set({
      phoneNumber: OTHER_PHONE, name: "Cust", address: "1 Main St",
      driverLicense: { frontPath: "dl.jpg" }, addressProof: { frontPath: "ap.jpg" },
    });
    // A live single-use join code. The code IS the credential, so no client may read it.
    await db.doc(`invites/A7K2M9QP`).set({ phone: MEMBER_PHONE, providerId: PROVIDER_ID, role: "staff", used: false, expiresAt: new Date(Date.now() + 86400000).toISOString() });
  });

  const owner = ctx(env, OWNER_PHONE);
  const other = ctx(env, OTHER_PHONE);
  const member = ctx(env, MEMBER_PHONE);

  console.log("providers:");
  await check("owner can update own provider doc",
    assertSucceeds(owner.doc(`providers/${PROVIDER_ID}`).update({ businessName: "Mine" })));
  await check("NON-owner CANNOT overwrite provider bank details",
    assertFails(other.doc(`providers/${PROVIDER_ID}`).update({ bankAccount: { routingNumber: "stolen" } })));
  await check("owner can create a provider doc carrying their phone",
    assertSucceeds(owner.doc(`providers/${OWNER_DIGITS}_10001`).set({ phoneNumber: OWNER_DIGITS, zipCode: "10001", onboarded: false })));
  await check("anyone authed can READ providers (browse)",
    assertSucceeds(other.doc(`providers/${PROVIDER_ID}`).get()));

  console.log("store membership (one store, several people):");
  await check("an INVITED MEMBER can update a store whose id carries someone else's phone",
    assertSucceeds(member.doc(`providers/${PROVIDER_ID}`).update({ businessName: "Ours" })));
  await check("a NON-member still cannot (membership is the whole check)",
    assertFails(other.doc(`providers/${PROVIDER_ID}`).update({ businessName: "Theirs" })));
  await check("a member CANNOT delete the store (owner/admin only)",
    assertFails(member.doc(`providers/${PROVIDER_ID}`).delete()));
  await check("a member can read the store's roster",
    assertSucceeds(member.doc(`providers/${PROVIDER_ID}/members/${OWNER_PHONE}`).get()));
  await check("a NON-member cannot read the roster",
    assertFails(other.doc(`providers/${PROVIDER_ID}/members/${OWNER_PHONE}`).get()));
  await check("NOBODY can write a member doc — self-grant would defeat invites entirely",
    assertFails(other.doc(`providers/${PROVIDER_ID}/members/${OTHER_PHONE}`).set({ phone: OTHER_PHONE, role: "staff" })));
  await check("not even a member can add another member",
    assertFails(member.doc(`providers/${PROVIDER_ID}/members/${OTHER_PHONE}`).set({ phone: OTHER_PHONE, role: "staff" })));
  await check("the store switcher's collection-group query returns only YOUR memberships",
    assertSucceeds(member.collectionGroup("members").where("phone", "==", MEMBER_PHONE).get()));
  await check("that query CANNOT be widened to read everyone's memberships",
    assertFails(member.collectionGroup("members").get()));
  await check("...nor pointed at somebody else's phone",
    assertFails(member.collectionGroup("members").where("phone", "==", OWNER_PHONE).get()));

  console.log("invites (the code is the credential):");
  await check("no client can READ an invite (a readable code list is a key ring)",
    assertFails(member.doc("invites/A7K2M9QP").get()));
  await check("no client can WRITE an invite (self-issue into any store)",
    assertFails(other.doc("invites/SELFMADE").set({ phone: OTHER_PHONE, providerId: PROVIDER_ID, used: false })));
  await check("even an admin cannot read invites (functions-only)",
    assertFails(adminCtx.doc("invites/A7K2M9QP").get()));

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

  // NOTE: this file used to assert rules for `salesTaxByZip` and `payouts`. Neither
  // collection was ever built — they existed nowhere but here, since the initial
  // commit, so both assertions had always failed. They are gone rather than
  // "fixed", because writing rules for them would open read surface on data that
  // does not exist:
  //   · Sales tax is declared per store at onboarding
  //     (providers/{id}.chargesSalesTax + salesTaxRate) and read straight off the
  //     provider doc — the rate that applies is the one for the jurisdiction the
  //     bike is delivered FROM, so there is no per-zip lookup table to publish.
  //   · There is no payout ledger. Stripe settles what the customer is charged
  //     directly; the only payout state is `payoutStatus` on the order itself.

  console.log("customer document review (hqStaff, deliberately narrow):");
  await check("store staff can stamp a customer's ID review",
    assertSucceeds(hqStaffCtx.doc(`users/${OTHER_PHONE}`).set(
      { driverLicense: { reviewedAt: "now", reviewedBy: PROVIDER_ID }, addressProof: { reviewedAt: "now" } },
      { merge: true })));
  await check("...and reject it (the mirror write)",
    assertSucceeds(hqStaffCtx.doc(`users/${OTHER_PHONE}`).set(
      { driverLicense: { rejectedReason: "blurry", reviewedAt: null } }, { merge: true })));
  await check("store staff CANNOT block a customer on the same write",
    assertFails(hqStaffCtx.doc(`users/${OTHER_PHONE}`).set(
      { driverLicense: { reviewedAt: "now" }, isBlocked: true }, { merge: true })));
  await check("store staff CANNOT rewrite a customer's profile",
    assertFails(hqStaffCtx.doc(`users/${OTHER_PHONE}`).set({ address: "somewhere else" }, { merge: true })));
  await check("store staff CANNOT delete a customer",
    assertFails(hqStaffCtx.doc(`users/${OTHER_PHONE}`).delete()));
  await check("a plain member with no hqStaff claim CANNOT review documents",
    assertFails(member.doc(`users/${OTHER_PHONE}`).set(
      { driverLicense: { reviewedAt: "now" } }, { merge: true })));

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
  await check("providerCancellations is denied to clients",
    assertFails(owner.doc(`providerCancellations/${PROVIDER_ID}`).get()));

  await env.cleanup();
  if (failures) { console.error(`\n${failures} rule assertion(s) FAILED`); process.exit(1); }
  console.log("\nAll rule assertions passed. Hardened rules compiled and behaved as expected.");
})().catch((e) => { console.error(e); process.exit(1); });
