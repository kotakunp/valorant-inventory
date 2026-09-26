import { useEffect, useState } from "react";
import type { StoreOffer, StoreSection } from "./types";

const imgUrl = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : null);
const fmt = (n: number) => n.toLocaleString("en-US");

function untilReset(expiryMs: number, now: number): string {
  const s = Math.max(0, Math.round((expiryMs - now) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function OfferCard({ o, nightMarket }: { o: StoreOffer; nightMarket?: boolean }) {
  return (
    <div className="store-card" title={o.name}>
      <div className="store-thumb">
        {imgUrl(o.icon) ? <img src={imgUrl(o.icon)!} alt="" loading="lazy" /> : <span>?</span>}
      </div>
      <div className="store-info">
        <div className="store-name">{o.name}</div>
        <div className="store-price">
          {nightMarket && o.discountPrice != null && o.price != null ? (
            <>
              <s>{fmt(o.price)}</s> <strong>{fmt(o.discountPrice)}</strong> VP
            </>
          ) : o.price != null ? (
            <>{fmt(o.price)} VP</>
          ) : (
            <span className="store-price-na">—</span>
          )}
          {o.owned && <span className="store-owned">OWNED</span>}
        </div>
      </div>
    </div>
  );
}

/** Sidebar store panel — daily offers + night market; editor-only, never exported. */
export function StorePanel({ store, generatedAt }: { store: StoreSection; generatedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const expiryMs =
    store.secondsToReset != null ? Date.parse(generatedAt) + store.secondsToReset * 1000 : null;
  const hasNight = store.nightMarket.length > 0;

  if (!store.offers.length && !hasNight) return null;

  return (
    <div className="panel store-panel">
      <h3>
        Store
        <span className="count">
          {expiryMs != null && expiryMs > now ? `resets in ${untilReset(expiryMs, now)}` : ""}
        </span>
      </h3>
      {store.offers.length > 0 && (
        <div className="store-grid">
          {store.offers.map((o) => (
            <OfferCard key={o.skinId} o={o} />
          ))}
        </div>
      )}
      {hasNight && (
        <>
          <div className="store-nm-label">Night market</div>
          <div className="store-grid store-grid--nm">
            {store.nightMarket.map((o) => (
              <OfferCard key={o.skinId} o={o} nightMarket />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
