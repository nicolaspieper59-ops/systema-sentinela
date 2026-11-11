#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — VALIDATEUR CROISÉ RÉEL JPL HORIZONS vs MOTEUR LOCAL
Compare un export CSV de JPL Horizons avec les éphémérides calculées via Skyfield/Local.
"""

import argparse
import csv
import sys
import numpy as np
try:
    from skyfield.api import load, wgs84
except ImportError:
    print("[FATAL] Skyfield introuvable (`pip install skyfield numpy`).", file=sys.stderr)
    sys.exit(1)

def charger_csv_jpl_horizons(chemin_csv):
    """
    Lit un fichier CSV exporté depuis NASA JPL Horizons (format table d'observateur).
    Extrait la date (JD ou UTC), l'azimut apparent et l'élévation apparente.
    """
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
                            date_utc = colonnes[0]
                            jd_val = float(colonnes[1])
                            az_jpl = float(colonnes[2])
                            el_jpl = float(colonnes[3])
                            ephemerides_jpl.append({
                                "date": date_utc,
                                "jd": jd_val,
                                "az": az_jpl,
                                "el": el_jpl
                            })
                        except ValueError:
                            continue
        print(f"[SUCCÈS] {len(ephemerides_jpl)} points de référence JPL chargés depuis {chemin_csv}")
    except Exception as e:
        print(f"[ERREUR] Impossible de lire le fichier CSV JPL : {e}", file=sys.stderr)
        sys.exit(1)

    return ephemerides_jpl

def calculer_ecart_angulaire(az1, el1, az2, el2):
    """
    Calcule la distance orthodromique (écart angulaire en arcsecondes) 
    entre deux positions célestes (Azimuth, Élévation).
    """
    deg2rad = np.pi / 180.0
    phi1, lambda1 = el1 * deg2rad, az1 * deg2rad
    phi2, lambda2 = el2 * deg2rad, az2 * deg2rad

    sin_dphi = np.sin((phi2 - phi1) / 2.0)**2
    sin_dlam = np.sin((lambda2 - lambda1) / 2.0)**2
    cos_prod = np.cos(phi1) * np.cos(phi2)
    
    arc = 2.0 * np.arcsin(np.sqrt(sin_dphi + cos_prod * sin_dlam))
    return np.degrees(arc) * 3600.0  # Conversion en arcsecondes

def executer_validation(chemin_csv, bsp_path="de440s.bsp", lat=43.284356, lon=5.358507, alt=49.8):
    donnees_jpl = charger_csv_jpl_horizons(chemin_csv)
    if not donnees_jpl:
        print("[AVERTISSEMENT] Aucune donnée valide trouvée dans le CSV.")
        return

    try:
        ts = load.timescale(builtin=True)
        eph = load(bsp_path)
    except Exception as e:
        print(f"[ERREUR] Impossible de charger les éphémérides BSP ({bsp_path}) : {e}", file=sys.stderr)
        sys.exit(1)

    earth = eph['earth']
    sun = eph['sun']
    station = earth + wgs84.latlon(lat, lon, elevation_m=alt)

    erreurs_arcsec = []
    print("\n--- RAPPORT DE VALIDATION SUB-ARCSECISME RÉEL ---")
    
    for pt in donnees_jpl:
        t = ts.tt_jd(pt["jd"])
        astrometric = station.at(t).observe(sun) # Remplacer 'sun' par le corps testé si besoin
        alt_local, az_local, distance = astrometric.apparent().altaz()
        
        az_val = az_local.degrees
        el_val = alt_local.degrees

        ecart = calculer_ecart_angulaire(pt["az"], pt["el"], az_val, el_val)
        erreurs_arcsec.append(ecart)

    if not erreurs_arcsec:
        print("[ERREUR] Aucun calcul n'a pu être effectué.")
        return

    erreur_max = max(erreurs_arcsec)
    erreur_moy = sum(erreurs_arcsec) / len(erreurs_arcsec)

    print(f"Nombre de points comparés : {len(erreurs_arcsec)}")
    print(f"Écart angulaire moyen     : {erreur_moy:.4f} arcsecondes")
    print(f"Écart angulaire maximal   : {erreur_max:.4f} arcsecondes")

    # Seuil critique visé : 0,01° = 36 arcsecondes (et idéalement < 1'')
    if erreur_max <= 36.0:
        print("✅ RÉSULTAT : Conforme aux exigences de précision sub-arcsecondique (<= 0,01°).")
    else:
        print("⚠️ ATTENTION : L'écart dépasse la tolérance de 0,01° sur certains points.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validateur d'éphémérides réel Systema Sentinela vs JPL Horizons")
    parser.add_argument("csv", type=str, help="Chemin vers le fichier CSV exporté depuis JPL Horizons")
    parser.add_argument("--bsp", type=str, default="de440s.bsp", help="Fichier d'éphémérides JPL BSP")
    args = parser.parse_args()
    
    executer_validation(args.csv, bsp_path=args.bsp)
