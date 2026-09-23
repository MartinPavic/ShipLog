import { Card } from "@/components/ui/card";

export function ShipLogHistory() {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">History</h2>
      <Card className="p-4 text-sm text-muted-foreground">
        No ship log entries yet.
      </Card>
    </div>
  );
}
