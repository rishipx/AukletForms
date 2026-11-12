'use client';

import { useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/components/shared/tag-input';
import type { FieldErrors, FormRecord } from '@/lib/types';

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-sm font-semibold text-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

type Defaults = Partial<
  Pick<FormRecord, 'name' | 'target_email' | 'allowed_domains' | 'redirect_url' | 'slack_webhook_url' | 'discord_webhook_url' | 'enable_turnstile'>
> & { has_turnstile_secret?: boolean };

export function FormSettingsFields({ idPrefix, defaults = {}, errors = {} }: { idPrefix: string; defaults?: Defaults; errors?: FieldErrors }) {
  const [turnstile, setTurnstile] = useState(defaults.enable_turnstile ?? false);
  const id = (field: string) => `${idPrefix}-${field}`;
  const describe = (field: keyof FieldErrors, hasHint: boolean) => (errors[field] ? `${id(field)}-error` : hasHint ? `${id(field)}-hint` : undefined);

  return (
    <div className="flex flex-col gap-6">
      <Section title="General">
        <Field id={id('name')} label="Form name" error={errors.name}>
          <Input
            id={id('name')}
            name="name"
            defaultValue={defaults.name ?? ''}
            placeholder="Website contact form"
            maxLength={120}
            required
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describe('name', false)}
          />
        </Field>
        <Field id={id('target_email')} label="Notification email" hint="Every submission is emailed here." error={errors.target_email}>
          <Input
            id={id('target_email')}
            name="target_email"
            type="email"
            defaultValue={defaults.target_email ?? ''}
            placeholder="you@company.com"
            required
            aria-invalid={errors.target_email ? true : undefined}
            aria-describedby={describe('target_email', true)}
          />
        </Field>
      </Section>

      <Section title="Security">
        <Field
          id={id('allowed_domains')}
          label="Allowed domains"
          hint={
            <>
              Only these sites can submit from a browser. Press Enter after each one: <span className="font-mono">example.com</span>,{' '}
              <span className="font-mono">localhost:3000</span>, <span className="font-mono">*.example.com</span> for subdomains. Leave empty to accept any
              website.
            </>
          }
          error={errors.allowed_domains}
        >
          <TagInput
            id={id('allowed_domains')}
            name="allowed_domains"
            defaultValue={defaults.allowed_domains ?? []}
            placeholder="example.com"
            invalid={Boolean(errors.allowed_domains)}
            describedBy={describe('allowed_domains', true)}
          />
        </Field>

        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor={id('enable_turnstile')}>Cloudflare Turnstile</Label>
              <p className="text-xs text-muted-foreground">Verify every submission with a Turnstile challenge. Requires your own Turnstile widget.</p>
            </div>
            <Switch id={id('enable_turnstile')} name="enable_turnstile" checked={turnstile} onCheckedChange={setTurnstile} />
          </div>
          {turnstile ? (
            <Field
              id={id('turnstile_secret_key')}
              label="Turnstile secret key"
              hint={
                defaults.has_turnstile_secret
                  ? 'A secret is saved (stored encrypted). Leave this blank to keep it, or paste a new one to replace it.'
                  : 'The secret half of your widget keys. Stored encrypted. Your site key goes in your HTML.'
              }
              error={errors.turnstile_secret_key}
            >
              <Input
                id={id('turnstile_secret_key')}
                name="turnstile_secret_key"
                type="password"
                autoComplete="off"
                defaultValue=""
                placeholder={defaults.has_turnstile_secret ? '•••••••• (saved)' : '0x4AAAAAAA…'}
                aria-invalid={errors.turnstile_secret_key ? true : undefined}
                aria-describedby={describe('turnstile_secret_key', true)}
              />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section title="Delivery">
        <Field
          id={id('redirect_url')}
          label="Redirect URL"
          hint="Where visitors land after a standard HTML form post. Leave empty to use the built-in thank-you page."
          error={errors.redirect_url}
        >
          <Input
            id={id('redirect_url')}
            name="redirect_url"
            type="url"
            defaultValue={defaults.redirect_url ?? ''}
            placeholder="https://example.com/thanks"
            aria-invalid={errors.redirect_url ? true : undefined}
            aria-describedby={describe('redirect_url', true)}
          />
        </Field>
        <Field
          id={id('slack_webhook_url')}
          label="Slack webhook URL"
          hint="Optional. Posts each submission to a Slack channel."
          error={errors.slack_webhook_url}
        >
          <Input
            id={id('slack_webhook_url')}
            name="slack_webhook_url"
            type="url"
            defaultValue={defaults.slack_webhook_url ?? ''}
            placeholder="https://hooks.slack.com/services/…"
            aria-invalid={errors.slack_webhook_url ? true : undefined}
            aria-describedby={describe('slack_webhook_url', true)}
          />
        </Field>
        <Field
          id={id('discord_webhook_url')}
          label="Discord webhook URL"
          hint="Optional. Posts each submission to a Discord channel."
          error={errors.discord_webhook_url}
        >
          <Input
            id={id('discord_webhook_url')}
            name="discord_webhook_url"
            type="url"
            defaultValue={defaults.discord_webhook_url ?? ''}
            placeholder="https://discord.com/api/webhooks/…"
            aria-invalid={errors.discord_webhook_url ? true : undefined}
            aria-describedby={describe('discord_webhook_url', true)}
          />
        </Field>
      </Section>
    </div>
  );
}
