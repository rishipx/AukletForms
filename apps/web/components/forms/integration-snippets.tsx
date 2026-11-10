'use client';

import { CopyButton } from '@/components/shared/copy-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { curlSnippet, htmlSnippet, reactSnippet } from '@/lib/forms/snippets';

function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative rounded-lg border bg-muted/50">
      <div className="absolute right-2 top-2">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 pr-28 font-mono text-[13px] leading-relaxed" tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function IntegrationSnippets({ endpoint, turnstile }: { endpoint: string; turnstile: boolean }) {
  const options = { endpoint, turnstile };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Your endpoint</h2>
        <div className="flex items-center gap-2 rounded-lg border bg-card p-2 pl-4">
          <code className="min-w-0 flex-1 truncate font-mono text-sm" title={endpoint}>
            POST {endpoint}
          </code>
          <CopyButton text={endpoint} label="Copy URL" />
        </div>
        <p className="text-xs text-muted-foreground">
          Accepts <span className="font-mono">application/json</span>, <span className="font-mono">multipart/form-data</span> and{' '}
          <span className="font-mono">application/x-www-form-urlencoded</span>. Send <span className="font-mono">Accept: application/json</span> to get{' '}
          <span className="font-mono">{'{ "success": true, "id": "…" }'}</span> back; plain HTML form posts are redirected to your Redirect URL.
        </p>
      </div>

      <Tabs defaultValue="html">
        <TabsList>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="react">Next.js / React</TabsTrigger>
          <TabsTrigger value="curl">curl</TabsTrigger>
        </TabsList>
        <TabsContent value="html">
          <CodeBlock code={htmlSnippet(options)} label="HTML snippet" />
        </TabsContent>
        <TabsContent value="react">
          <CodeBlock code={reactSnippet(options)} label="Next.js or React snippet" />
        </TabsContent>
        <TabsContent value="curl">
          <CodeBlock code={curlSnippet(options)} label="curl command" />
        </TabsContent>
      </Tabs>

      {turnstile ? (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          Turnstile is on for this form, so submissions without a valid <span className="font-mono">cf-turnstile-response</span> are rejected. Replace{' '}
          <span className="font-mono">YOUR_TURNSTILE_SITE_KEY</span> in the snippets with your widget&apos;s site key. The{' '}
          <span className="font-mono">curl</span> example will be rejected until you add a token.
        </p>
      ) : null}
    </div>
  );
}
