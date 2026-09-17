// Types de scripts/clubs-geo/clubsGeo.mjs (pour les tests TypeScript).
export interface Point { lat: number; lng: number }
export interface ClubBase {
  id: string; name: string; city: string;
  latitude: number | null; longitude: number | null; geo_confidence: string | null;
}
export interface ClubFichier { ville: string; nom: string; adresse: string; lat: number; lng: number; statut: string }
export interface Proposition { fichier: ClubFichier | null; communs: string[]; score: number; alertes: string[] }
export type Decision =
  | { type: 'vide' } | { type: 'oui' } | { type: 'non' }
  | { type: 'lien'; texte: string } | { type: 'inconnu'; texte: string };

export function sansAccents(s: string | null | undefined): string;
export function normaliserVille(s: string | null | undefined): string;
export function motsSignificatifs(nom: string, motsVille?: Set<string>): Set<string>;
export function distanceKm(a: Point, b: Point): number;
export function centresVilles(clubs: ClubBase[]): Map<string, Point>;
export const LOIN_DE_LA_VILLE_KM: number;
export function proposerCorrespondance(club: ClubBase, fichier: ClubFichier[], centre?: Point): Proposition;
export function marquerPointsPartages(propositions: Proposition[]): Proposition[];
export function lireLienMaps(texte: string): Point | null;
export function estLienCourt(texte: string): boolean;
export const MAROC: { latMin: number; latMax: number; lngMin: number; lngMax: number };
export const MAX_KM_DE_LA_VILLE: number;
export function controlerPoint(point: Point, centre: Point | undefined, ville: string): string[];
export function lireDecision(cellule: unknown): Decision;
export const SOURCE_VERIFICATION: string;
export function requeteMiseAJour(p: { id: string; lat: number; lng: number }): string;
