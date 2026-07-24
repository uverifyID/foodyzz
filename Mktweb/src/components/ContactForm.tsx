"use client";

import { useState } from "react";
import { site } from "@/lib/siteConfig";

type Status = "idle" | "sending" | "sent" | "error";

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  const configured = site.formspreeId && site.formspreeId !== "your-form-id";
  const endpoint = `https://formspree.io/f/${site.formspreeId}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) {
      setStatus("error");
      setError("Contact form isn't set up yet — please email us directly.");
      return;
    }
    setStatus("sending");
    setError("");

    const form = e.currentTarget;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const msg = json?.errors?.[0]?.message as string | undefined;
        throw new Error(msg || "Something went wrong.");
      }
      setStatus("sent");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "sent") {
    return (
      <div className="brutal-card bg-accent-yellow p-8 text-center">
        <p className="font-display text-3xl uppercase">Thanks!</p>
        <p className="mt-2 text-ink/75">
          Your message is on its way. We&apos;ll get back to you soon.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Honeypot — bots fill it, humans never see it. Formspree drops these. */}
      <input
        type="text"
        name="_gotcha"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden
      />

      <Field label="Name" name="name" required />
      <Field label="Email" name="email" type="email" required />
      <Field label="Subject" name="subject" />

      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-tight">
          Message
        </label>
        <textarea
          name="message"
          required
          rows={5}
          className="w-full border-2 border-ink bg-paper px-4 py-3 shadow-brutal-sm outline-none focus:bg-accent-yellow/30"
        />
      </div>

      {status === "error" && (
        <p className="border-2 border-ink bg-accent-pink px-4 py-3 text-sm font-semibold">
          {error}{" "}
          <a href={`mailto:${site.email}`} className="underline">
            {site.email}
          </a>
        </p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="bg-ink px-7 py-3.5 text-sm font-bold uppercase tracking-tight text-paper shadow-brutal-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-60"
      >
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required = false,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-bold uppercase tracking-tight">
        {label}
        {required && <span className="text-brand-orange"> *</span>}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        className="w-full border-2 border-ink bg-paper px-4 py-3 shadow-brutal-sm outline-none focus:bg-accent-yellow/30"
      />
    </div>
  );
}
