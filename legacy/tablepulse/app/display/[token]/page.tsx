import { PublicScreen } from "@/components/public-screen";
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <PublicScreen token={(await params).token} />;
}
