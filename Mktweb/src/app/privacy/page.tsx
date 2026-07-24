import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How UniHamper collects, uses, and shares your information across the UniHamper and UniHamper HQ apps — and the choices you have.",
};

const LAST_UPDATED = "June 30, 2026";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <span className="inline-block border-2 border-ink bg-accent-pink px-3 py-1.5 text-xs font-bold uppercase tracking-widest shadow-brutal-sm">
        Your privacy
      </span>
      <h1 className="display-heading mt-6 text-5xl sm:text-6xl">
        Privacy Policy
      </h1>
      <p className="mt-4 text-sm font-bold uppercase tracking-widest text-ink/50">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="brutal-card mt-8 bg-accent-blue p-6">
        <p className="font-bold leading-relaxed text-ink">
          We collect only what we need to connect you with a laundry provider,
          process your order, and pay everyone correctly. We do not sell your
          personal information, and we do not use third-party advertising or
          analytics trackers.
        </p>
      </div>

      <p className="mt-8 leading-relaxed text-ink/70">
        This Privacy Policy explains how UniHamper Inc. (&quot;UniHamper,&quot;
        &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) collects, uses, and
        shares information when you use the UniHamper customer app, the UniHamper HQ
        provider app, the UniHamper manager portal, and this website (together, the
        &quot;Platform&quot;). By using the Platform, you agree to this Policy.
        It should be read together with our{" "}
        <Link href="/terms" className="font-bold underline">
          Terms &amp; Conditions
        </Link>
        .
      </p>

      <Section n="01" title="Information we collect">
        <p>We collect the following categories of information:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account &amp; contact details.</strong> Your name, mobile
            phone number, email address, and — for managers — a password.
          </li>
          <li>
            <strong>Addresses &amp; location.</strong> Your street address and
            ZIP code, the pickup and delivery addresses on an order, and
            geographic coordinates (latitude/longitude) derived from those
            addresses. With your permission, the app uses your device location to
            set a search anchor for finding nearby providers.
          </li>
          <li>
            <strong>Order information.</strong> Order details, scheduling and
            turnaround preferences, notes you add (such as detergent or folding
            instructions), order history, and any ratings or feedback you leave.
          </li>
          <li>
            <strong>Payment information.</strong> Payments are handled by Stripe.
            We store references that link your account to Stripe (such as a
            customer or connected-account identifier); we do not store your full
            card number or bank-account number on our systems.
          </li>
          <li>
            <strong>Provider information.</strong> For providers, we also collect
            your business name, pricing, tax settings, payout cadence, and the
            identity and bank-verification information required by Stripe Connect
            to pay you. Your location may be shared during an active pickup or
            delivery.
          </li>
          <li>
            <strong>Device &amp; notification data.</strong> A push-notification
            token for your device so we can send order updates, and basic
            settings such as notification preferences.
          </li>
          <li>
            <strong>Referral data.</strong> If you join through a school
            manager&apos;s referral code, we record the code and the referring
            manager for attribution.
          </li>
          <li>
            <strong>Website contact form.</strong> If you message us through this
            site, we collect the name, email, and message you submit.
          </li>
        </ul>
      </Section>

      <Section n="02" title="How we authenticate you">
        <p>
          Customers and providers sign in with their mobile phone number and a
          one-time code sent by SMS. Managers sign in with an email address, a
          password, and a second factor sent by SMS. Phone verification uses
          Google reCAPTCHA Enterprise to protect against abuse.
        </p>
      </Section>

      <Section n="03" title="How we use your information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To create and secure your account and verify your identity.</li>
          <li>
            To match orders with nearby providers, route pickups and deliveries,
            and show order status.
          </li>
          <li>
            To authorize, charge, calculate, and settle payments, fees, taxes,
            payouts, and manager commissions.
          </li>
          <li>To send order updates, receipts, and service notifications.</li>
          <li>
            To provide support, prevent fraud and abuse, enforce our Terms, and
            comply with legal obligations.
          </li>
        </ul>
      </Section>

      <Section n="04" title="How we share your information">
        <p>
          We share information only as needed to operate the Platform. We do not
          sell your personal information.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Between customers and providers.</strong> To fulfill an
            order, the assigned provider receives the information needed to
            complete it (such as the pickup/delivery address and order details).
            Providers receive a redacted view of order data and do not receive
            your full payment details.
          </li>
          <li>
            <strong>Service providers we rely on.</strong> We share data with the
            vendors that power the Platform, listed below.
          </li>
          <li>
            <strong>Legal and safety.</strong> We may disclose information to
            comply with law, enforce our Terms, or protect the rights, property,
            or safety of users and the public.
          </li>
          <li>
            <strong>Business transfers.</strong> Information may be transferred as
            part of a merger, acquisition, or sale of assets.
          </li>
        </ul>
      </Section>

      <Section n="05" title="Third-party services we use">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Google Firebase</strong> (authentication, database, and cloud
            functions) — stores account, order, and profile data and runs the
            backend.
          </li>
          <li>
            <strong>Stripe and Stripe Connect</strong> — processes customer
            payments and provider payouts, including identity and bank
            verification.
          </li>
          <li>
            <strong>Expo push notifications</strong> (delivered via Apple and
            Google push services) — sends order updates to your device.
          </li>
          <li>
            <strong>Google reCAPTCHA Enterprise</strong> — protects phone
            verification against abuse.
          </li>
          <li>
            <strong>Google Maps Platform</strong> (geocoding, places, and
            distance) — turns addresses into coordinates and estimates distances.
          </li>
          <li>
            <strong>Email delivery (SMTP)</strong> — sends transactional email
            such as receipts and notifications.
          </li>
          <li>
            <strong>Formspree</strong> — receives messages you submit through the
            contact form on this website.
          </li>
        </ul>
        <p>
          Each provider processes data under its own terms and privacy policy. We
          do not use third-party advertising networks or analytics trackers.
        </p>
      </Section>

      <Section n="06" title="Data retention">
        <p>
          We keep your information for as long as your account is active and as
          needed to provide the Platform, then for any additional period required
          to meet legal, tax, accounting, fraud-prevention, and dispute-
          resolution obligations. Payment and payout records are retained as
          required by law and by our payment processor.
        </p>
      </Section>

      <Section n="07" title="Your choices and rights">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Notifications.</strong> You can turn off push notifications in
            your device settings; some service messages may still be sent.
          </li>
          <li>
            <strong>Location.</strong> You can disable location permission in your
            device settings, though this may limit provider search.
          </li>
          <li>
            <strong>Access and deletion.</strong> Depending on where you live, you
            may have rights to access, correct, or delete your personal
            information, or to object to or restrict certain processing. To make a
            request, contact us at{" "}
            <a href="mailto:privacy@unihamper.com" className="font-bold underline">
              privacy@unihamper.com
            </a>
            . We will respond as required by applicable law.
          </li>
          <li>
            <strong>No sale of data.</strong> We do not sell personal information,
            and we do not share it for cross-context behavioral advertising.
          </li>
        </ul>
      </Section>

      <Section n="08" title="Security">
        <p>
          We use reasonable administrative and technical safeguards to protect
          your information, and we rely on established processors such as Google
          and Stripe. No method of transmission or storage is completely secure,
          so we cannot guarantee absolute security. Keep your device and account
          credentials protected.
        </p>
      </Section>

      <Section n="09" title="Children's privacy">
        <p>
          The Platform is not directed to children, and we do not knowingly
          collect personal information from children. If you believe a child has
          provided us information, contact us and we will delete it.
        </p>
      </Section>

      <Section n="10" title="Changes to this Policy">
        <p>
          We may update this Policy from time to time. When we do, we will revise
          the &quot;Last updated&quot; date above. Your continued use of the
          Platform after changes take effect constitutes acceptance of the
          updated Policy.
        </p>
      </Section>

      <Section n="11" title="Contact">
        <p>
          Questions or privacy requests? Reach us at{" "}
          <a href="mailto:privacy@unihamper.com" className="font-bold underline">
            privacy@unihamper.com
          </a>{" "}
          or through our{" "}
          <Link href="/contact" className="font-bold underline">
            contact page
          </Link>
          .
        </p>
        <p className="text-sm">UniHamper Inc., New York, NY 10001</p>
      </Section>
    </div>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12">
      <h2 className="display-heading flex items-baseline gap-3 text-2xl sm:text-3xl">
        <span className="text-brand-orange">{n}</span>
        <span>{title}</span>
      </h2>
      <div className="mt-4 space-y-4 leading-relaxed text-ink/70">{children}</div>
    </section>
  );
}
