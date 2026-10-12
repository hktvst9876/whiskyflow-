import Link from "next/link";
import { Activity } from "lucide-react";
export default function NotFound() {
  return (
    <div className="login-page">
      <div className="login-card">
        <Activity size={30} color="#6e9156" />
        <h1>This table isn’t on our floor.</h1>
        <p>The page may have moved. Return to your workspace to continue.</p>
        <Link className="button primary" href="/">
          Back to the overview
        </Link>
      </div>
    </div>
  );
}
