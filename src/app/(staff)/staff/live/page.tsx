import { LiveTab } from "./tabs/live-tab";

/** Default tab — served at /staff/live. */
export default function LivePage() {
  return <LiveTab active />;
}
