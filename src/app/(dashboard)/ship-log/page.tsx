import { ShipLogForm } from "@/components/ship-log-form";
import { ShipLogHistory } from "@/components/ship-log-history";

export default function ShipLogPage() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">AI Ship Log</h1>
      <ShipLogForm />
      <ShipLogHistory />
    </div>
  );
}
