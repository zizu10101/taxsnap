"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/components/theme-sync";
import type { ThemePreference } from "@/lib/database.types";

export function ThemeSettings() {
  const { preference, setPreference } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Theme</CardTitle>
        <CardDescription>Choose how TaxSnap looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={preference}
          onValueChange={(v) => v && setPreference(v as ThemePreference)}
        >
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="light">Light</TabsTrigger>
            <TabsTrigger value="dark">Dark</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardContent>
    </Card>
  );
}
