import { getPreference, setPreference } from "@/lib/preferences";
import { createDataset } from "@/lib/datasets";
import { createSession } from "@/lib/sessions";

const SEED_KEY = "getting_started_seeded";

export async function seedGettingStarted(): Promise<void> {
  const already = await getPreference(SEED_KEY);
  if (already) return;

  const [btcResp, spxResp] = await Promise.all([
    fetch("/samples/btc_daily.csv"),
    fetch("/samples/spx_daily.csv"),
  ]);

  if (!btcResp.ok || !spxResp.ok) {
    console.warn("[seed] Failed to fetch sample CSVs, skipping seed");
    return;
  }

  const [btcBytes, spxBytes] = await Promise.all([
    btcResp.arrayBuffer().then((b) => new Uint8Array(b)),
    spxResp.arrayBuffer().then((b) => new Uint8Array(b)),
  ]);

  const btc = await createDataset("btc_daily.csv", btcBytes);
  const spx = await createDataset("spx_daily.csv", spxBytes);

  await createSession("Getting Started — BTC & SPX", [btc.id, spx.id]);
  await setPreference(SEED_KEY, "true");
}
