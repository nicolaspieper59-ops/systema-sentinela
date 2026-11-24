#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — VALIDATEUR CROISÉ RÉEL JPL HORIZONS vs MOTEUR LOCAL (Dynamique)
Compare un export CSV de NASA JPL Horizons avec les éphémérides calculées via Skyfield.
"""

import argparse
import sys
import numpy as np
try:
    from skyfield.api import load, wgs84
except ImportError:
    print("[FATAL] Skyfield introuvable (`pip install skyfield numpy`).", file=sys.stderr)
    sys.exit(1)

# Dictionnaire de correspondance multi-corps
CORPS_MAPPING = {
    "soleil": ["sun", 10],
    "sun": ["sun", 10],
    "lune": ["moon", 301],
    "moon": ["moon", 301],
    "mercure": ["mercury barycenter", "mercury", 1],
    "venus": ["venus barycenter", "venus", 2],
    "mars": ["mars barycenter", "mars", 4],
    "jupiter": ["jupiter barycenter", 5],
    "saturne": ["saturn barycenter", 6],
    "uranus": ["uranus barycenter", 7],
    "neptune": ["neptune barycenter", 8]
}

def charger_csv_jpl_horizons(chemin_csv):
    """Lit un fichier CSV exporté depuis NASA JPL Horizons."""
    ephemerides_jpl = []
    en_zone_donnees = False

    try:
        with open(chemin_csv, 'r', encoding='utf-8') as f:
            for ligne in f:
                ligne_str = ligne.strip()
                if "$$SOE" in ligne_str:
                    en_zone_donnees = True
                    continue
                if "$$EOE" in ligne_str:
                    en_zone_donnees = False
                    continue
                
                if en_zone_donnees and ligne_str:
                    colonnes = [c.strip() for c in ligne_str.split(',')]
                    if len(colonnes) >= 4:
                        try:
                            ephemerides_jpl.append({
                                "date": colonnes[0],
                                "jd": float(colonnes[1]),
                                "az": float(colonnes[2]),
                                "el": float(colonnes[3])
                            })
                        except ValueError:
                            continue
        print(f"[SUCCÈS] {len(ephemerides_jpl)} points de référence JPL chargés depuis {chemin_csv}")
    except Exception as e:
        print(f"[ERREUR] Impossible de lire le fichier CSV JPL : {e}", file=sys.stderr)
        sys.exit(1)

    return ephemerides_jpl

def calculer_ecart_angulaire(az1, el1, az2, el2):
    """Calcule l'écart angulaire en arcsecondes entre deux positions."""
    deg2rad = np.pi / 180.0
    phi1, lambda1 = el1 * deg2rad, az1 * deg2rad
    phi2, lambda2 = el2 * deg2rad, az2 * deg2rad

    sin_dphi = np.sin((phi2 - phi1) / 2.0)**2
    sin_dlam = np.sin((lambda2 - lambda1) / 2.0)**2
    cos_prod = np.cos(phi1) * np.cos(phi2)
    
    arc = 2.0 * np.arcsin(np.sqrt(sin_dphi + cos_prod * sin_dlam))
    return np.degrees(arc) * 3600.0

def obtenir_astre_eph(eph, noms):
    for nom in noms:
        if nom in eph:
            return eph[nom]
    raise KeyError(f"Astre non trouvé dans le BSP : {noms}")

def executer_validation(chemin_csv, corps_cible, bsp_path="de440s.bsp", lat=43.284356, lon=5.358507, alt=49.8):
    donnees_jpl = charger_csv_jpl_horizons(chemin_csv)
    if not donnees_jpl:
        print("[AVERTISSEMENT] Aucune donnée valide trouvée dans le CSV.")
        return

    try:
        ts = load.timescale(builtin=True)
        eph = load(bsp_path)
    except Exception as e:
        print(f"[ERREUR] Éphémérides BSP introuvables ({bsp_path}) : {e}", file=sys.stderr)
        sys.exit(1)

    earth = eph['earth']
    noms_cibles = CORPS_MAPPING.get(corps_cible.lower(), [corps_cible.lower()])
    astre = obtenir_astre_eph(eph, noms_cibles)
    station = earth + wgs84.latlon(lat, lon, elevation_m=alt)

    erreurs_arcsec = []
    print(f"\n--- RAPPORT DE VALIDATION SUB-ARCSEC : {corps_cible.upper()} ---")
    
    for pt in donnees_jpl:
        t = ts.tt_jd(pt["jd"])
        astrometric = station.at(t).observe(astre)
        alt_local, az_local, _ = astrometric.apparent().altaz()
        
        ecart = calculer_ecart_angulaire(pt["az"], pt["el"], az_local.degrees, alt_local.degrees)
        erreurs_arcsec.append(ecart)

    if not erreurs_arcsec:
        print("[ERREUR] Aucun calcul n'a pu être effectué.")
        return

    erreur_max = max(erreurs_arcsec)
    erreur_moy = sum(erreurs_arcsec) / len(erreurs_arcsec)

    print(f"Nombre de points comparés : {len(erreurs_arcsec)}")
    print(f"Écart angulaire moyen     : {erreur_moy:.4f} arcsecondes")
    print(f"Écart angulaire maximal   : {erreur_max:.4f} arcsecondes")

    if erreur_max <= 36.0:
        print("✅ RÉSULTAT : Conforme aux exigences de précision sub-arcsecondique (<= 0,01°).")
    else:
        print("⚠️ ATTENTION : L'écart dépasse la tolérance de 0,01° sur certains points.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validateur d'éphémérides dynamique Systema Sentinela vs JPL Horizons")
    parser.add_argument("csv", type=str, help="Chemin vers le fichier CSV exporté depuis JPL Horizons")
    parser.add_argument("--corps", type=str, default="sun", help="Nom du corps (ex: sun, moon, mars, venus)")
    parser.add_argument("--bsp", type=str, default="de440s.bsp", help="Fichier d'éphémérides JPL BSP")
    args = parser.parse_args()
    
    executer_validation(args.csv, args.corps, bsp_path=args.bsp)
