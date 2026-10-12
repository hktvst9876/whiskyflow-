import { MemberPortal } from "@/components/member-portal";
export const metadata = {
  title: "Your membership · TablePulse",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function MemberPage() {
  return <MemberPortal />;
}
