import type { Metadata } from "next";
import { getPublishedPage } from "@/lib/cms/get-page";
import { MarkdownRenderer } from "@/components/cms/markdown-renderer";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublishedPage("privacy");
  return {
    title: page?.metaTitle ?? "Privacy Policy",
    description:
      page?.metaDescription ??
      "How iTrader.im collects, uses and protects your personal data under the Isle of Man Applied GDPR.",
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-text-primary font-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PrivacyFallback() {
  return (
    <div className="space-y-8 text-sm leading-relaxed text-text-secondary">
      <div className="rounded-lg border border-border bg-surface/60 px-4 py-3 text-xs text-text-tertiary">
        Last updated: March 2026
      </div>

      <Section title="1. Introduction">
        <p>
          iTrader.im (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is a
          vehicle marketplace platform for the Isle of Man. This Privacy Policy
          explains how we collect, use, store and protect your personal data when
          you use our website and services.
        </p>
        <p>
          We are committed to protecting your privacy and handling your data in
          accordance with the Isle of Man&apos;s data protection legislation,
          including the{" "}
          <strong className="text-text-primary">
            Data Protection Act 2018
          </strong>
          , the{" "}
          <strong className="text-text-primary">
            GDPR and LED Implementing Regulations 2018
          </strong>
          , and the{" "}
          <strong className="text-text-primary">
            Data Protection (Application of GDPR) Order 2018
          </strong>{" "}
          (together referred to as the &quot;Applied GDPR&quot;).
        </p>
      </Section>

      <Section title="2. Data Controller">
        <p>
          iTrader.im is the data controller responsible for your personal data.
          If you have questions about this policy or wish to exercise your data
          protection rights, please contact us at{" "}
          <a
            href="mailto:privacy@itrader.im"
            className="text-neon-blue-400 underline hover:text-neon-blue-300"
          >
            privacy@itrader.im
          </a>
          .
        </p>
      </Section>

      <Section title="3. What Data We Collect">
        <p>
          The categories of personal data we collect depend on how you interact
          with us:
        </p>

        <div className="space-y-4 pl-1">
          <div>
            <h3 className="text-sm font-medium text-text-primary">
              Pre-launch waiting list
            </h3>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-text-secondary">
              <li>Email address</li>
              <li>
                Stated interests (e.g. buying vehicles, selling vehicles,
                dealer)
              </li>
              <li>Date and time of registration</li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-primary">
              When the platform launches
            </h3>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-text-secondary">
              <li>Account information (name, email address, phone number)</li>
              <li>Vehicle listing details and photographs</li>
              <li>Messages exchanged through the platform</li>
              <li>Transaction and payment records</li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-medium text-text-primary">
              Automatically collected data
            </h3>
            <ul className="mt-1.5 list-inside list-disc space-y-1 text-text-secondary">
              <li>IP address and approximate location</li>
              <li>Browser type, device type and operating system</li>
              <li>Pages visited and interactions with the site</li>
              <li>
                Cookies and similar technologies (see our{" "}
                <a
                  href="/cookies"
                  className="text-neon-blue-400 underline hover:text-neon-blue-300"
                >
                  Cookie Policy
                </a>
                )
              </li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="4. How We Use Your Data">
        <p>We process your personal data for the following purposes:</p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            To manage our pre-launch waiting list and notify you when the
            platform launches
          </li>
          <li>To provide, maintain and improve our marketplace services</li>
          <li>To create and manage your account</li>
          <li>To process transactions and payments</li>
          <li>
            To communicate with you about your account, listings or enquiries
          </li>
          <li>
            To send marketing communications where you have given consent
          </li>
          <li>
            To detect and prevent fraud, abuse or security incidents
          </li>
          <li>To comply with legal obligations</li>
        </ul>
      </Section>

      <Section title="5. Lawful Basis for Processing">
        <p>
          Under the Applied GDPR, we must have a lawful basis for processing
          your personal data. The bases we rely on include:
        </p>
        <ul className="list-inside list-disc space-y-1.5">
          <li>
            <strong className="text-text-primary">Consent</strong> — when you
            sign up to our waiting list or opt in to marketing communications.
            You may withdraw consent at any time.
          </li>
          <li>
            <strong className="text-text-primary">
              Contractual necessity
            </strong>{" "}
            — to provide you with the marketplace services you have requested,
            such as publishing a listing or facilitating a sale.
          </li>
          <li>
            <strong className="text-text-primary">Legitimate interests</strong>{" "}
            — to improve our platform, ensure security and prevent fraud, where
            our interests do not override your fundamental rights and freedoms.
          </li>
          <li>
            <strong className="text-text-primary">Legal obligation</strong> — to
            comply with applicable laws and regulations in the Isle of Man.
          </li>
        </ul>
      </Section>

      <Section title="6. Data Sharing">
        <p>
          We do not sell your personal data. We may share your data with the
          following categories of recipients where necessary to operate our
          services:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong className="text-text-primary">
              Email delivery providers
            </strong>{" "}
            — to send transactional and marketing emails on our behalf
          </li>
          <li>
            <strong className="text-text-primary">
              Hosting and infrastructure providers
            </strong>{" "}
            — to host our website and store data securely
          </li>
          <li>
            <strong className="text-text-primary">
              Authentication providers
            </strong>{" "}
            — to manage secure sign-in to your account
          </li>
          <li>
            <strong className="text-text-primary">Payment processors</strong> —
            to handle payments securely (we do not store full payment card
            details)
          </li>
          <li>
            <strong className="text-text-primary">
              Law enforcement or regulatory bodies
            </strong>{" "}
            — where required by Isle of Man law or to protect our legal rights
          </li>
        </ul>
        <p>
          All third-party processors are bound by data processing agreements and
          are required to handle your data in accordance with applicable data
          protection legislation.
        </p>
      </Section>

      <Section title="7. International Data Transfers">
        <p>
          Some of our service providers may process personal data outside the
          Isle of Man. Where this occurs, we ensure that appropriate safeguards
          are in place as required by the Applied GDPR, such as standard
          contractual clauses or adequacy decisions, to protect your data to an
          equivalent standard.
        </p>
      </Section>

      <Section title="8. Data Retention">
        <p>
          We retain your personal data only for as long as necessary to fulfil
          the purposes for which it was collected:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong className="text-text-primary">Waiting list data</strong> —
            retained until the platform launches or until you request removal,
            whichever is sooner
          </li>
          <li>
            <strong className="text-text-primary">Account data</strong> —
            retained while your account is active and for a reasonable period
            afterwards to comply with legal obligations
          </li>
          <li>
            <strong className="text-text-primary">Transaction records</strong> —
            retained as required by applicable Isle of Man law
          </li>
        </ul>
        <p>
          When personal data is no longer required, it is securely deleted or
          anonymised.
        </p>
      </Section>

      <Section title="9. Your Rights">
        <p>
          Under the Applied GDPR, you have the following rights in relation to
          your personal data:
        </p>
        <ul className="list-inside list-disc space-y-1.5">
          <li>
            <strong className="text-text-primary">Right of access</strong> — to
            request a copy of the personal data we hold about you
          </li>
          <li>
            <strong className="text-text-primary">Right to rectification</strong>{" "}
            — to request correction of inaccurate or incomplete data
          </li>
          <li>
            <strong className="text-text-primary">Right to erasure</strong> — to
            request deletion of your personal data in certain circumstances
          </li>
          <li>
            <strong className="text-text-primary">
              Right to restrict processing
            </strong>{" "}
            — to request that we limit how we use your data
          </li>
          <li>
            <strong className="text-text-primary">
              Right to data portability
            </strong>{" "}
            — to receive your data in a commonly used, machine-readable format
          </li>
          <li>
            <strong className="text-text-primary">Right to object</strong> — to
            object to processing based on legitimate interests or for direct
            marketing purposes
          </li>
          <li>
            <strong className="text-text-primary">
              Right to withdraw consent
            </strong>{" "}
            — where processing is based on consent, you may withdraw it at any
            time without affecting the lawfulness of prior processing
          </li>
        </ul>
        <p>
          To exercise any of these rights, please contact us at{" "}
          <a
            href="mailto:privacy@itrader.im"
            className="text-neon-blue-400 underline hover:text-neon-blue-300"
          >
            privacy@itrader.im
          </a>
          . We will respond within one month of receiving your request.
        </p>
      </Section>

      <Section title="10. Marketing Communications">
        <p>
          We will only send you marketing communications where you have given
          your consent, in accordance with the Isle of Man&apos;s Unsolicited
          Communications Regulations. You can withdraw your consent or
          unsubscribe at any time by:
        </p>
        <ul className="list-inside list-disc space-y-1">
          <li>Clicking the unsubscribe link in any marketing email</li>
          <li>
            Contacting us at{" "}
            <a
              href="mailto:privacy@itrader.im"
              className="text-neon-blue-400 underline hover:text-neon-blue-300"
            >
              privacy@itrader.im
            </a>
          </li>
        </ul>
      </Section>

      <Section title="11. Children&apos;s Privacy">
        <p>
          Our services are not directed at children under the age of 13. We do
          not knowingly collect personal data from children under 13. Under the
          Applied GDPR, consent for information society services cannot be given
          by a child below the age of 13 in the Isle of Man. If we become aware
          that we have collected data from a child under 13 without valid
          parental consent, we will delete that data promptly.
        </p>
      </Section>

      <Section title="12. Data Security">
        <p>
          We implement appropriate technical and organisational measures to
          protect your personal data against unauthorised access, alteration,
          disclosure or destruction. These measures include encryption of data in
          transit, secure authentication, access controls and regular review of
          our security practices.
        </p>
        <p>
          While we take every reasonable precaution, no method of transmission
          over the internet or electronic storage is completely secure.
        </p>
      </Section>

      <Section title="13. Changes to This Policy">
        <p>
          We may update this Privacy Policy from time to time to reflect changes
          in our practices or legal requirements. Where changes are significant,
          we will notify you by email or by placing a prominent notice on our
          website. The &quot;last updated&quot; date at the top of this page
          indicates when the policy was last revised.
        </p>
      </Section>

      <Section title="14. Complaints and Supervisory Authority">
        <p>
          If you are unhappy with how we have handled your personal data, you
          have the right to lodge a complaint with the Isle of Man Information
          Commissioner:
        </p>
        <div className="mt-2 rounded-lg border border-border bg-surface/60 px-4 py-3">
          <p className="font-medium text-text-primary">
            Isle of Man Information Commissioner
          </p>
          <p className="mt-1">
            Website:{" "}
            <a
              href="https://www.inforights.im"
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-blue-400 underline hover:text-neon-blue-300"
            >
              www.inforights.im
            </a>
          </p>
        </div>
      </Section>

      <Section title="15. Contact Us">
        <p>
          If you have any questions about this Privacy Policy or wish to
          exercise your data protection rights, please contact us:
        </p>
        <div className="mt-2 rounded-lg border border-border bg-surface/60 px-4 py-3">
          <p>
            Email:{" "}
            <a
              href="mailto:privacy@itrader.im"
              className="text-neon-blue-400 underline hover:text-neon-blue-300"
            >
              privacy@itrader.im
            </a>
          </p>
        </div>
      </Section>
    </div>
  );
}

export default async function PrivacyPage() {
  const page = await getPublishedPage("privacy");

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="section-heading-accent text-2xl sm:text-3xl font-bold text-text-primary font-heading">
        {page?.title ?? "Privacy Policy"}
      </h1>
      <div className="mt-6">
        {page ? (
          <MarkdownRenderer content={page.markdown} />
        ) : (
          <PrivacyFallback />
        )}
      </div>
    </div>
  );
}
