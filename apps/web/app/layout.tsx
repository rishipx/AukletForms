import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Auklet Forms', template: '%s · Auklet Forms' },
  description: 'Form endpoints for developers. Point your HTML form at Auklet and get submissions by email, Slack and Discord.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#12181d' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
