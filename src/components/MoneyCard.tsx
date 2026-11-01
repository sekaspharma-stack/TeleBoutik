import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { formatNumber } from '../lib/utils';

export interface MoneyCardProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  usd: number;
  cdf: number;
  /** Dégradé de la carte (hexadécimal). */
  from: string;
  to: string;
  footer?: ReactNode;
  className?: string;
}

/** Carte unique qui regroupe les deux devises (USD + CDF) d'un même indicateur. */
export function MoneyCard({ title, subtitle, icon: Icon, usd, cdf, from, to, footer, className = '' }: MoneyCardProps) {
  const style = { '--g1': from, '--g2': to } as CSSProperties;
  return (
    <section className={`money-card ${className}`} style={style} aria-label={title}>
      <div className="money-card-head">
        <span className="money-card-icon"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="money-card-title">{title}</p>
          {subtitle && <p className="money-card-sub">{subtitle}</p>}
        </div>
      </div>
      <div className="money-card-grid">
        <div className="money-card-cell">
          <p className="money-card-cur">USD</p>
          <p className="money-card-amount">$ {formatNumber(usd, 2)}</p>
        </div>
        <div className="money-card-cell">
          <p className="money-card-cur">CDF</p>
          <p className="money-card-amount">{formatNumber(cdf, 0)} <span className="text-xs font-semibold opacity-80">FC</span></p>
        </div>
      </div>
      {footer && <div className="money-card-foot">{footer}</div>}
    </section>
  );
}

/** Variante claire (fond teinté) pour les cartes secondaires qui ont aussi deux devises. */
export function SoftMoneyCard({ title, subtitle, icon: Icon, usd, cdf, color, footer, className = '' }: {
  title: string; subtitle?: string; icon: LucideIcon; usd: number; cdf: number; color: string; footer?: ReactNode; className?: string;
}) {
  const style = { '--kc': color } as CSSProperties;
  return (
    <section className={`kpi-card ${className}`} style={style} aria-label={title}>
      <div className="flex items-center gap-2">
        <span className="kpi-icon !mb-0"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold" style={{ color: 'var(--text)' }}>{title}</p>
          {subtitle && <p className="kpi-label">{subtitle}</p>}
        </div>
      </div>
      <div className="kpi-cells mt-3">
        <div className="kpi-cell"><p className="money-card-cur">USD</p><p className="money-card-amount">$ {formatNumber(usd, 2)}</p></div>
        <div className="kpi-cell"><p className="money-card-cur">CDF</p><p className="money-card-amount">{formatNumber(cdf, 0)} <span className="text-xs font-semibold opacity-70">FC</span></p></div>
      </div>
      {footer && <div className="kpi-label mt-2">{footer}</div>}
    </section>
  );
}

/** Carte indicateur simple (nombre unique), même langage visuel. */
export function KpiCard({ label, value, icon: Icon, color, hint }: { label: string; value: string; icon: LucideIcon; color: string; hint?: string }) {
  const style = { '--kc': color } as CSSProperties;
  return (
    <div className="kpi-card" style={style}>
      <span className="kpi-icon"><Icon className="h-4 w-4" /></span>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {hint && <p className="kpi-label mt-0.5">{hint}</p>}
    </div>
  );
}
