"use client";

import { PanelLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomizeMenuEditor, type MenuRecordCounts } from "@/components/dashboard/customize-menu";

// Settings -> Navigation: the same "Customize menu" panel the sidebar and mobile
// drawer open, here with record counts so hiding a tab that still has data asks
// first. Cosmetic only: it tidies this owner's own sidebar / bottom bar and changes
// nothing about access, permissions or the records themselves.
export function NavigationSettings({
  isPro,
  hiddenNavKeys,
  recordCounts,
}: {
  isPro: boolean;
  hiddenNavKeys: readonly string[];
  recordCounts: MenuRecordCounts;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PanelLeft className="h-4 w-4" />
          Navigation
        </CardTitle>
        <CardDescription>Choose which tabs show in your sidebar and bottom bar.</CardDescription>
      </CardHeader>
      <CardContent>
        <CustomizeMenuEditor isPro={isPro} hiddenNavKeys={hiddenNavKeys} recordCounts={recordCounts} twoColumns />
      </CardContent>
    </Card>
  );
}
