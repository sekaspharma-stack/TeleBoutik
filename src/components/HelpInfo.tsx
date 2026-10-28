import { useState } from 'react';
import { ChevronDown, CircleHelp } from 'lucide-react';
import { useLocation } from 'react-router-dom';

type Help = { title: string; usage: string; dependencies: string; tips: string };
const HELP: Record<string, Help> = {
  '/dashboard': { title: 'Tableau de bord', usage: 'Consulte les indicateurs de l’activité et repère rapidement les alertes.', dependencies: 'Les indicateurs dépendent des ventes, du stock, de la caisse et des dépenses enregistrés.', tips: 'En cas de connexion instable, vérifie le statut de synchronisation avant de comparer plusieurs appareils.' },
  '/pos': { title: 'Point de vente', usage: 'Recherche les articles, ajoute les quantités au panier, sélectionne le paiement puis valide la vente. Une fois la vente enregistrée, ouvre le reçu pour choisir l’impression thermique ou système.', dependencies: 'Les produits et variantes doivent être créés dans Stock. Une caisse ouverte est nécessaire pour les mouvements de paiement. L’impression ne modifie pas la vente déjà enregistrée.', tips: 'Vérifie la devise et le montant reçu avant de confirmer. En cas d’échec d’impression, ne valide pas une nouvelle vente : réouvre le ticket depuis Ventes et réessaie une seule méthode.' },
  '/stock': { title: 'Stock boutique', usage: 'Ajoute les produits, définis les prix et suis les quantités disponibles.', dependencies: 'Les produits et leurs variantes sont nécessaires avant les ventes au Point de vente.', tips: 'Enregistre chaque réception et correction de stock afin de garder une traçabilité claire.' },
  '/sales': { title: 'Ventes et reçus', usage: 'Consulte l’historique des tickets, les paiements et la référence de chaque reçu. Ouvre un ticket pour imprimer ou partager son contenu.', dependencies: 'Les tickets proviennent du Point de vente. Le reçu utilise les données enregistrées de la vente, ses lignes, les IMEI, le vendeur, le client et les paiements.', tips: 'Logo : configure-le dans Paramètres pour l’afficher sur le reçu. Le reçu HTML/PDF inclut le logo ; l’impression thermique directe l’inclut si le pont natif prend en charge les images ESC/POS. Thermique Bluetooth : disponible uniquement si le pont natif compatible est installé ou si le navigateur prend en charge l’imprimante BLE UART. Sinon utilise Impression système / PDF. Après un envoi Bluetooth partiel, ne relance pas automatiquement une autre méthode : vérifie d’abord l’imprimante pour éviter un doublon.' },
  '/cash': { title: 'Caisse', usage: 'Ouvre une session au début du service, enregistre les dépôts/retraits, puis clôture après comptage physique.', dependencies: 'Les ventes, dépenses et opérations Airtel associées à la session modifient les soldes théoriques.', tips: 'Le solde théorique est calculé à partir des mouvements enregistrés. À la clôture, compte l’argent physique séparément du solde e-float Airtel.' },
  '/airtel-money': { title: 'Shop Airtel Money', usage: 'Enregistre les dépôts (Cash In) et retraits (Cash Out) et vérifie les montants avant validation.', dependencies: 'Une caisse ouverte et un solde de départ correctement saisi sont nécessaires pour suivre les mouvements.', tips: 'Le cash physique et l’e-float Airtel sont deux soldes différents. Une opération annulée doit garder ses écritures de contrepassation.' },
  '/telecom-sales': { title: 'Vente d’unités & Megas', usage: 'Définis séparément le stock d’unités et le stock de Megas, puis saisis la quantité vendue, le coût et le prix reçu.', dependencies: 'Une caisse ouverte est requise. Le stock unités/Megas est distinct du solde e-float Airtel Money.', tips: 'La quantité diminue du stock télécom; le paiement reçu augmente la caisse selon le mode et la devise, tandis que le coût e-float est enregistré séparément.' },
  '/sim-cards': { title: 'Cartes SIM', usage: 'Gère les SIM avec numéro individuel ou ajoute un stock en vrac vendable à l’unité ou par carton.', dependencies: 'Une caisse ouverte est nécessaire pour vendre. Un carton représente 250 cartes SIM.', tips: 'Pour les lots en vrac, saisis le coût et le prix par SIM. La vente d’un carton déduit 250 SIM du stock.' },
  '/cabins': { title: 'Cabines & agents', usage: 'Crée les cabines, active ou désactive un registre et attribue un agent.', dependencies: 'Les agents doivent déjà exister dans la gestion des utilisateurs. La caisse doit être ouverte dans le registre choisi.', tips: 'Vérifie l’attribution avant le début du service et évite d’ouvrir deux sessions sur le même registre.' },
  '/reports-commissions': { title: 'Rapports & commissions', usage: 'Choisis une période et une devise pour comparer les volumes, ventes, coûts et commissions estimées.', dependencies: 'Les rapports reposent sur les opérations effectivement enregistrées dans les modules de vente, SIM, Airtel et dépenses.', tips: 'Les commissions sont estimatives. Compare toujours les rapports avec les mouvements de caisse et les relevés opérateur.' },
  '/customers': { title: 'Clients', usage: 'Ajoute et retrouve les clients pour relier les opérations qui nécessitent une identification.', dependencies: 'Les fiches clients peuvent être utilisées dans les ventes et le suivi des crédits lorsqu’il est activé.', tips: 'Évite de créer plusieurs fiches pour un même numéro. Vérifie le numéro de téléphone avant de préparer une relance.' },
  '/operations': { title: 'Gestion avancée', usage: 'Utilise les outils de suivi avancé disponibles pour les garanties, le SAV, les dettes, les sauvegardes ou les autres fonctions activées dans cette version.', dependencies: 'Les résultats dépendent des ventes, des clients, des IMEI et des écritures déjà enregistrés. Certaines actions nécessitent une autorisation de gérant ou propriétaire.', tips: 'Avant une opération sensible, vérifie la boutique active et effectue une sauvegarde. Une relance préparée n’est pas forcément envoyée automatiquement.' },
  '/audit': { title: 'Audit', usage: 'Consulte les événements et les changements importants réalisés dans l’application.', dependencies: 'Les actions doivent être enregistrées par les modules concernés.', tips: 'Utilise l’audit pour investiguer une différence sans supprimer les écritures d’origine.' },
  '/settings': { title: 'Paramètres', usage: 'Configure les informations de la boutique, son logo, les utilisateurs, les devises, les taux, les sauvegardes et la largeur du reçu (58 mm ou 80 mm). Pour le logo, choisis une image puis enregistre-la : elle s’affiche à côté du nom TeleBoutik. Appuie sur le logo dans l’en-tête ou le menu pour actualiser la page.', dependencies: 'Le logo est enregistré dans la base locale de cet appareil. Les paramètres de boutique et les données synchronisées suivent le mécanisme de synchronisation existant. La largeur choisie est utilisée par les sorties d’impression thermique et HTML.', tips: 'Garde une copie du logo original. Pour une imprimante Bluetooth classique SPP, un pont natif doit exposer window.teleboutikPrinter.printRawBytes ou printText. Web Bluetooth ne fonctionne qu’en contexte HTTPS compatible et pour les imprimantes BLE compatibles. Teste la largeur et les accents sur le matériel réel.' },
};
export default function HelpInfo() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const help = HELP[pathname] ?? { title: 'Aide du module', usage: 'Utilise les formulaires pour enregistrer les opérations puis vérifie leur présence dans l’historique.', dependencies: 'Les informations affichées dépendent des données déjà enregistrées dans les modules liés.', tips: 'En cas de réseau instable, continue avec prudence et vérifie la synchronisation au retour de la connexion.' };
  return (
    <section className="card mb-5 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700"><CircleHelp className="h-4 w-4" /></span>
        <span className="flex-1">Aide : {help.title}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-slate-100 bg-slate-50/60 px-4 py-4 text-sm text-slate-600 animate-fade-in md:grid-cols-3">
          <div><p className="mb-1 font-semibold text-slate-800">Comment utiliser</p><p className="leading-relaxed">{help.usage}</p></div>
          <div><p className="mb-1 font-semibold text-slate-800">Dépendances</p><p className="leading-relaxed">{help.dependencies}</p></div>
          <div><p className="mb-1 font-semibold text-slate-800">Astuce</p><p className="leading-relaxed">{help.tips}</p></div>
        </div>
      )}
    </section>
  );
}
