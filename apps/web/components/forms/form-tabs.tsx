'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type FormTab = 'submissions' | 'integration' | 'settings';

export function FormTabs({
  defaultTab,
  submissions,
  integration,
  settings,
}: {
  defaultTab: FormTab;
  submissions: ReactNode;
  integration: ReactNode;
  settings: ReactNode;
}) {
  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="submissions">Submissions</TabsTrigger>
        <TabsTrigger value="integration">Integration</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="submissions">{submissions}</TabsContent>
      <TabsContent value="integration">{integration}</TabsContent>
      <TabsContent value="settings">{settings}</TabsContent>
    </Tabs>
  );
}
