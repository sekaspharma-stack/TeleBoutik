export type OpsStore = { id: string; name: string; currency: string };
export type OpsUser = { id: string; role: string };
export type OpsCustomer = { id: string; name: string; phone: string };
export interface OpsTabProps {
  store: OpsStore;
  user: OpsUser;
  customers: OpsCustomer[];
  notify: (message: string) => void;
  fail: (message: string) => void;
}
export const todayIso = () => new Date().toLocaleDateString('en-CA');
export const money = (v: number, c = 'CDF') =>
  new Intl.NumberFormat('fr-CD', { style: 'currency', currency: c, maximumFractionDigits: c === 'CDF' ? 0 : 2 }).format(Number(v || 0));
export const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
