import { useEffect, useState } from "react";
import { rarityColor, rarityLabel } from "./logic";
import type { AccessoryOffer, StoreOffer, StoreSection } from "./types";

const imgUrl = (u: string | null) => (u ? `/img/${encodeURIComponent(u)}` : null);
const fmt = (n: number) => n.toLocaleString("en-US");

/** #rrggbb → #rrggbbaa (rarity-tinted card outline). */
const hexA = (hex: string, a: number) =>
  `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

const VP_ICON =
  "https://media.valorant-api.com/currencies/85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741/displayicon.png";
const KC_ICON =
  "https://media.valorant-api.com/currencies/85ca954a-41f2-ce94-9b45-8ca3dd39a00d/displayicon.png";

const KIND_LABEL: Record<AccessoryOffer["kind"], string> = {
  spray: "SPRAY",
  buddy: "BUDDY",
  card: "CARD",
  title: "TITLE",
};

function hhmmss(totalSec: number): string {
  const s = Math.max(0, totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}

function SectionHead({ label, time }: { label: string; time?: string | null }) {
  return (
    <div className="sstore-head">
      <span className="sstore-head-line" />
      <span className="sstore-head-title">{label}</span>
      {time && <span className="sstore-head-time">{time}</span>}
      <span className="sstore-head-line" />
    </div>
  );
}

function SkinCard({ o, nightMarket }: { o: StoreOffer; nightMarket?: boolean }) {
  const art = imgUrl(o.icon);
  const rarity = rarityColor(o.price, 0, o.contentTierRank ?? null);
  // Night-market discount tag ("-40%"), same math as the struck/discounted prices.
  const discountPct =
    nightMarket && o.price != null && o.price > 0 && o.discountPrice != null
      ? Math.round((1 - o.discountPrice / o.price) * 100)
      : null;
  return (
    <article
      className="sstore-card"
      title={o.name}
      style={{ borderColor: hexA(rarity, 0.55), "--rarity": rarity } as React.CSSProperties}
    >
      <div className="sstore-art">
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="sstore-art-fb">?</span>}
      </div>
      {discountPct != null && discountPct > 0 && (
        <span className="sstore-discount">−{discountPct}%</span>
      )}
      <div className="sstore-bar">
        <div className="sstore-meta">
          <span className="sstore-name">{o.name}</span>
          <span className="sstore-rarity">
            {o.contentTierIcon && <img className="sstore-rarity-gem" src={imgUrl(o.contentTierIcon)!} alt="" />}
            {rarityLabel(o.price, 0, o.contentTierRank ?? null)}
          </span>
        </div>
        {nightMarket && o.discountPrice != null ? (
          <span className="sstore-price sstore-price--nm">
            {o.price != null && <s>{fmt(o.price)}</s>}
            <strong>
              {o.discountPrice != null ? fmt(o.discountPrice) : "—"} <img src={imgUrl(VP_ICON)!} alt="VP" />
            </strong>
          </span>
        ) : (
          <span className="sstore-price">
            {o.price != null ? (
              <>
                {fmt(o.price)} <img src={imgUrl(VP_ICON)!} alt="VP" />
              </>
            ) : (
              <span className="sstore-price-na">—</span>
            )}
          </span>
        )}
        {o.owned && <span className="sstore-owned">OWNED</span>}
      </div>
    </article>
  );
}

function AccessoryCard({ o }: { o: AccessoryOffer }) {
  const art = imgUrl(o.icon);
  return (
    <article className="sstore-card" title={o.name}>
      <div className="sstore-art">
        {art ? <img src={art} alt="" loading="lazy" /> : <span className="sstore-art-fb">{KIND_LABEL[o.kind]}</span>}
      </div>
      <div className="sstore-bar">
        <span className="sstore-name">{o.name}</span>
        <span className="sstore-price">
          {o.price != null ? (
            <>
              {fmt(o.price)} <img src={imgUrl(KC_ICON)!} alt="KC" />
            </>
          ) : (
            <span className="sstore-price-na">—</span>
          )}
        </span>
      </div>
    </article>
  );
}

/**
 * Store strip under the showcase (editor-only, never exported) — in-game look:
 * DAILY OFFERS with HH:MM:SS countdown, night market, Kingdom-Credit accessories.
 */
export function StorePanel({
  store,
  generatedAt,
  width,
}: {
  store: StoreSection;
  generatedAt: string;
  /** Matches the preview frame width so the strip hugs the canvas at any zoom. */
  width?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const expiryMs =
    store.secondsToReset != null ? Date.parse(generatedAt) + store.secondsToReset * 1000 : null;
  const resetLeft = expiryMs != null ? Math.round((expiryMs - now) / 1000) : null;

  const hasDaily = store.offers.length > 0;
  const hasNight = store.nightMarket.length > 0;
  const hasAcc = store.accessories.length > 0;
  if (!hasDaily && !hasNight && !hasAcc) return null;

  return (
    <div className="store-strip" style={width ? { width } : undefined}>
      {hasDaily && (
        <section>
          <SectionHead label="DAILY OFFERS" time={resetLeft != null && resetLeft > 0 ? hhmmss(resetLeft) : null} />
          <div className="sstore-row sstore-row--daily">
            {store.offers.map((o) => (
              <SkinCard key={o.skinId} o={o} />
            ))}
          </div>
        </section>
      )}
      {hasNight && (
        <section>
          <SectionHead label="NIGHT MARKET" />
          <div className="sstore-row">
            {store.nightMarket.map((o) => (
              <SkinCard key={o.skinId} o={o} nightMarket />
            ))}
          </div>
        </section>
      )}
      {hasAcc && (
        <section>
          <SectionHead label="ACCESSORIES" />
          <div className="sstore-row sstore-row--scroll">
            {store.accessories.map((o) => (
              <AccessoryCard key={o.id} o={o} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
