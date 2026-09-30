import { PortalPage } from "@/components/portal-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function ComingSoonPage({
  title,
  subtitle,
  description,
}: {
  title: string;
  subtitle?: string;
  description?: string;
}) {
  return (
    <PortalPage title={title} subtitle={subtitle ?? "Module preview"}>
      <Card>
        <CardContent className="p-10 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 text-primary grid place-items-center">
            <Sparkles className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold">Coming soon</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {description ??
              "This module is scaffolded and ready for configuration. Full workflows will be enabled shortly."}
          </p>
        </CardContent>
      </Card>
    </PortalPage>
  );
}
