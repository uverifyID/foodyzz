import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "The terms that govern your use of UniHamper and UniHamper HQ — how orders, pricing, payments, payouts, and the marketplace work.",
};

const LAST_UPDATED = "June 30, 2026";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <span className="inline-block border-2 border-ink bg-accent-blue px-3 py-1.5 text-xs font-bold uppercase tracking-widest shadow-brutal-sm">
        The fine print
      </span>
      <h1 className="display-heading mt-6 text-5xl sm:text-6xl">
        Terms &amp; Conditions
      </h1>
      <p className="mt-4 text-sm font-bold uppercase tracking-widest text-ink/50">
        Last updated: {LAST_UPDATED}
      </p>

      <div className="brutal-card mt-8 bg-accent-yellow p-6">
        <p className="font-bold leading-relaxed text-ink">
          UniHamper is a marketplace that connects people who need laundry done
          with independent service providers who wash, dry, fold, and return it.
          We are not a laundry company and we do not clean your clothes
          ourselves. Please read these Terms carefully — they explain who is
          responsible for what.
        </p>
      </div>

      <p className="mt-8 leading-relaxed text-ink/70">
        These Terms &amp; Conditions (the &quot;Terms&quot;) form a binding
        agreement between you and UniHamper Inc. (&quot;UniHamper,&quot;
        &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) governing your access
        to and use of
        the UniHamper customer app, the UniHamper HQ provider app, the UniHamper ambassador
        portal, and this website (together, the &quot;Platform&quot;). By
        creating an account, placing or accepting an order, or otherwise using
        the Platform, you agree to these Terms. If you do not agree, do not use
        the Platform.
      </p>

      <Section n="01" title="What UniHamper is — and is not">
        <p>
          UniHamper operates a two-sided marketplace. The UniHamper app is used by{" "}
          <strong>customers</strong> to request laundry services. The UniHamper HQ
          app is used by independent <strong>service providers</strong> (also
          called &quot;providers&quot; or &quot;fleets&quot;) to accept and
          fulfill those requests. The UniHamper ambassador portal is used by{" "}
          <strong>school ambassadors</strong>, who are independent referral
          partners.
        </p>
        <p>
          UniHamper <strong>only connects customers and providers</strong>. The
          laundry services themselves — washing, drying, folding, pickup, and
          delivery — are performed entirely by independent providers, who are
          not employees, agents, or representatives of UniHamper. We do not control
          and are not responsible for the quality, timing, safety, or legality
          of any provider&apos;s services, nor for the acts or omissions of any
          provider or customer.
        </p>
      </Section>

      <Section n="02" title="Eligibility and accounts">
        <p>
          You must be able to form a legally binding contract to use the
          Platform, and you must provide accurate information when you register.
          The Platform is not directed to children, and you may not use it if
          you are under the age of majority in your jurisdiction. Customers and
          providers sign in using their mobile phone number and a one-time code
          sent by SMS; ambassadors sign in with an email address, a password, and a
          second factor sent by SMS. You are responsible for keeping your account
          and device secure and for all activity that occurs under your account.
        </p>
        <p>
          We may refuse, suspend, block, or terminate any account at our
          discretion, including for violation of these Terms or for conduct we
          reasonably believe harms the Platform, providers, customers, or third
          parties.
        </p>
      </Section>

      <Section n="03" title="How an order works">
        <p>
          A customer creates an order describing the laundry, the desired
          turnaround, and whether the order is a <strong>drop-off</strong> (the
          customer brings the laundry to the provider) or a{" "}
          <strong>pickup &amp; delivery</strong> (the provider collects and
          returns the laundry). The order is offered to eligible providers within
          the customer&apos;s selected search radius.
        </p>
        <p>
          A provider then accepts (claims) the order and moves it through pickup,
          processing, and delivery until it is marked delivered. Order status,
          estimated turnaround, and — during active pickup and delivery — the
          provider&apos;s location may be shown in the app. Turnaround windows
          are estimates set by the provider and are not guaranteed by UniHamper.
        </p>
      </Section>

      <Section n="04" title="Pricing, authorization, and payment (customers)">
        <p>
          Payments are processed by Stripe. By placing an order you authorize
          UniHamper and its payment processor to charge your payment method for the
          amounts described below, and{" "}
          <strong>you are responsible for paying for the services you order.</strong>
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Estimate at request.</strong> When you submit a request, we
            place a payment authorization (a hold) for an{" "}
            <strong>estimated</strong> amount. This is an estimate only.
          </li>
          <li>
            <strong>Finalized on acceptance.</strong> The price becomes final
            when a provider accepts your order, based on that provider&apos;s
            pricing.
          </li>
          <li>
            <strong>Charged when service begins.</strong> Your payment method is
            charged when the service begins. Once charged, you are responsible
            for that amount.
          </li>
          <li>
            <strong>Changes are confirmed first.</strong> If the price needs to
            change after acceptance (for example, the actual load is larger than
            estimated), the change is presented to you for confirmation and you
            are notified. You become responsible for the revised amount only
            after you confirm it. If you do not approve a change, the order may
            be cancelled.
          </li>
        </ul>
      </Section>

      <Section n="05" title="Fees and taxes">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Service price.</strong> Set by the provider you choose and
            shown to you before you confirm.
          </li>
          <li>
            <strong>Platform fees.</strong> UniHamper charges commission, platform,
            and related fees. These fees, along with payment-processing and
            per-transaction fees (which are based on Stripe, administrative, and
            platform charges), belong to UniHamper.
          </li>
          <li>
            <strong>Minimum commission.</strong> UniHamper applies a minimum
            commission threshold on each order. Where an order does not meet that
            threshold, the difference is charged to the customer rather than the
            provider. This keeps the Platform operational, secure, and available
            to everyone.
          </li>
          <li>
            <strong>Sales tax.</strong> Sales tax, where applicable, is declared
            and set by the provider and applies to the service subtotal only.
            <strong> No tax is charged on delivery.</strong>
          </li>
          <li>
            <strong>Tips.</strong> Tips are optional, go to the provider, and are
            not refundable once submitted.
          </li>
          <li>
            <strong>Promotions.</strong> Coupons and promotional discounts are
            subject to their own terms, may be limited to a single use per
            customer, and may lock an order to a specific provider.
          </li>
        </ul>
      </Section>

      <Section n="06" title="Cancellations, adjustments, and refunds">
        <p>
          You may cancel an order before a provider begins service; once service
          has begun, the order may not be cancellable and charges may apply.
          Where a provider proposes a price adjustment, the order pauses for your
          confirmation and the authorization is updated accordingly before work
          continues. Refunds, where offered, are handled on a case-by-case basis
          and processed through Stripe. Because providers perform the services,
          refund and re-do requests relating to service quality are resolved
          directly with the provider as described below.
        </p>
      </Section>

      <Section n="07" title="Customer responsibilities and disputes">
        <p>
          UniHamper only connects you with independent providers. If a problem
          arises with an order — damage, loss, a quality issue, or a missed
          window — <strong>you are responsible for working directly with the
          provider to resolve and mitigate the issue.</strong> UniHamper may, but is
          not obligated to, assist. You agree to provide accurate pickup and
          delivery information, to make your laundry available as scheduled, and
          not to include prohibited, hazardous, or illegal items. You are
          responsible for items of unusual value and for disclosing special care
          requirements in advance.
        </p>
      </Section>

      <Section n="08" title="Provider terms (UniHamper HQ)">
        <p>
          Providers are <strong>independent contractors</strong>, not employees
          of UniHamper. Nothing in these Terms creates an employment, partnership,
          agency, or joint-venture relationship. As a provider, you agree that:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>You are paid based on your onboarding pricing.</strong> The
            commission, platform fees, and other fees paid by the customer belong
            to the Platform.
          </li>
          <li>
            <strong>Taxes are your responsibility.</strong> You are solely
            responsible for determining, collecting where applicable, reporting,
            and remitting all taxes arising from your services, including any
            sales tax you declare.
          </li>
          <li>
            <strong>Pickup and delivery are your responsibility to manage.</strong>{" "}
            If you use a driver, you are responsible for paying that driver.
            UniHamper is not a party to and is not responsible for any agreement
            between you and a driver. No tax is charged on delivery.
          </li>
          <li>
            <strong>UniHamper pays you directly.</strong> Payouts are made to you
            through Stripe Connect, which requires identity and bank
            verification. You are responsible for the accuracy of your payout
            details.
          </li>
          <li>
            <strong>You manage your own customer issues.</strong> If you have an
            issue with a customer, it is your responsibility to manage and
            mitigate it. UniHamper only helps connect customers and providers.
          </li>
          <li>
            You must provide your services lawfully and safely, maintain any
            required licenses or equipment, and handle customer property with
            reasonable care.
          </li>
        </ul>
      </Section>

      <Section n="09" title="Provider settlement and payouts">
        <p>
          Provider payouts are made from funds that have been settled, cleared,
          and are available to the Platform, and are deposited in aggregate.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Daily settlement (on request).</strong> If you request daily
            settlement, payment is made within 24 hours after the funds have
            cleared and the Platform has received them. A{" "}
            <strong>$0.99 charge</strong> applies to daily settlement, and the
            settled, cleared, and available balance is deposited in aggregate.
          </li>
          <li>
            <strong>Semi-monthly settlement.</strong> If you choose to be paid on
            the 1st and the 15th of each month, your settled, cleared, and
            available funds are deposited in aggregate on those dates.
          </li>
        </ul>
        <p>
          Settlement timing also depends on Stripe and your bank. UniHamper is not
          responsible for delays caused by payment processors, financial
          institutions, or incomplete verification.
        </p>
      </Section>

      <Section n="10" title="School Ambassador program">
        <p>
          School ambassadors are <strong>independent referral partners</strong>,
          not employees, who recruit providers and customers to a campus or
          community. Ambassadors are not authorized to speak or contract on behalf
          of UniHamper.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Commission.</strong> An ambassador earns a percentage of the{" "}
            <em>platform&apos;s</em> commission on each completed and delivered
            order fulfilled by a provider the ambassador referred. The commission is
            a share of platform revenue — not of the order total and not of the
            provider&apos;s pay.
          </li>
          <li>
            <strong>Earned orders only.</strong> Commission accrues only on
            orders that reach completed or delivered status. Cancelled,
            in-progress, or unfulfilled orders earn nothing.
          </li>
          <li>
            <strong>Attribution.</strong> Provider referral attribution is set
            once and is permanent for that provider. The referring ambassador for an
            order is frozen at the time the provider is assigned and is not
            changed afterward.
          </li>
          <li>
            <strong>Payouts.</strong> Ambassador commission amounts are calculated
            by the Platform and paid out of band on a periodic basis (around the
            1st and 15th of the month). Payouts are discretionary, may be subject
            to verification, and carry no guaranteed minimum.
          </li>
          <li>
            <strong>Rate and standing.</strong> UniHamper may set, adjust, or remove
            an ambassador&apos;s commission rate or standing at any time. Removal
            deactivates the ambassador&apos;s referral code and ends future
            attribution.
          </li>
        </ul>
      </Section>

      <Section n="11" title="Acceptable use">
        <p>
          You agree not to misuse the Platform, including by: providing false
          information; circumventing fees or routing payments off-platform;
          interfering with or disrupting the Platform; attempting unauthorized
          access; harassing or harming other users; or using the Platform for any
          unlawful purpose. We may remove content and suspend or terminate
          accounts that violate these rules.
        </p>
      </Section>

      <Section n="12" title="Disclaimers">
        <p>
          The Platform is provided &quot;as is&quot; and &quot;as available,&quot;
          without warranties of any kind, whether express or implied, including
          warranties of merchantability, fitness for a particular purpose, and
          non-infringement. UniHamper does not warrant that the Platform will be
          uninterrupted or error-free, or that any provider&apos;s services will
          meet your expectations. Providers are solely responsible for their
          services.
        </p>
      </Section>

      <Section n="13" title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, UniHamper and its officers,
          employees, and partners will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or for any
          loss of profits, data, goodwill, or for lost, damaged, or delayed
          laundry handled by a provider. To the fullest extent permitted by law,
          our total liability for any claim relating to the Platform will not
          exceed the greater of the fees UniHamper earned on the order giving rise
          to the claim or fifty U.S. dollars (US$50).
        </p>
      </Section>

      <Section n="14" title="Indemnification">
        <p>
          You agree to indemnify and hold UniHamper harmless from any claims,
          damages, liabilities, and expenses (including reasonable legal fees)
          arising out of your use of the Platform, your violation of these Terms,
          your violation of any law or third-party right, or — for providers —
          the services you provide and your relationships with drivers and
          customers.
        </p>
      </Section>

      <Section n="15" title="Changes to these Terms">
        <p>
          We may update these Terms from time to time. When we do, we will revise
          the &quot;Last updated&quot; date above. Your continued use of the
          Platform after changes take effect constitutes acceptance of the
          updated Terms.
        </p>
      </Section>

      <Section n="16" title="Governing law and disputes">
        <p>
          These Terms are governed by the laws of the State of New York and the
          United States, without regard to conflict-of-laws rules. Disputes
          between customers and providers are resolved directly between those
          parties. Any dispute with UniHamper will be resolved in the state or
          federal courts located in New York, New York, except where prohibited
          by law.
        </p>
      </Section>

      <Section n="17" title="Contact">
        <p>
          Questions about these Terms? Reach us at{" "}
          <a href="mailto:legal@unihamper.com" className="font-bold underline">
            legal@unihamper.com
          </a>{" "}
          or through our{" "}
          <Link href="/contact" className="font-bold underline">
            contact page
          </Link>
          . See also our{" "}
          <Link href="/privacy" className="font-bold underline">
            Privacy Policy
          </Link>
          .
        </p>
        <p className="text-sm">
          UniHamper Inc., New York, NY 10001
        </p>
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
