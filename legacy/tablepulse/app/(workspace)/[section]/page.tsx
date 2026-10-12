import { notFound } from "next/navigation";
import { TablesView } from "@/components/tables";
import {
  OffersView,
  MenuView,
  SettingsView,
  ActivityView,
  AnalyticsView,
} from "@/components/management";
import { SimulatorView } from "@/components/simulator";
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  switch (section) {
    case "tables":
      return <TablesView />;
    case "offers":
      return <OffersView />;
    case "menu":
      return <MenuView />;
    case "settings":
      return <SettingsView />;
    case "activity":
      return <ActivityView />;
    case "analytics":
      return <AnalyticsView />;
    case "simulator":
      return <SimulatorView />;
    default:
      notFound();
  }
}
