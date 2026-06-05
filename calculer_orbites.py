#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
import time
from datetime import datetime, timezone
from skyfield.api import Topos, load

def calculer_refraction_dynamique(altitude_brute_deg, altitude_observateur_m):
    if altitude_brute_deg < -0.5: 
        return altitude_brute_deg
    pression_hpa = 1013.25 * math.pow(1.0 - (0.0065 * altitude_observateur_m) / 288.15, 5.255)
    temperature_kelvin = 288.15 - (0.0065 * altitude_observateur_m)
    angle_rad = (altitude_brute_deg + 7.31 / (altitude_brute_deg + 4.4)) * (math.pi / 180.0)
    cotangente = 1.0 / math.tan(angle_rad)
    correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)
    return altitude_brute_deg + correction_arcmin

def executer_acquisition():
    print("[INFO] SENTINELA - Initialisation du Noyau Éphémérides Terrestres")
    
    if not os.path.exists('de421.bsp'):
        print("[ERREUR CRITIQUE] Fichier de421.bsp absent ou corrompu.")
        sys.exit(1)
        
    eph = load('de421.bsp')
    ts = load.timescale()
    
    # Extraction temporelle via le standard UTC absolu (indépendant de tout paramètre OS)
    maintenant = datetime.now(timezone.utc)
    annee = maintenant.year
    mois = maintenant.month
    jour = maintenant.day
    
    print(f"[REPERE TEMPOREL] Grille Astronomique Universelle : {annee}-{mois:02d}-{jour:02d}")
    
    # Positionnement Topocentrique de l'antenne (Marseille)
    LATITUDE = 43.28
    LONGITUDE = 5.36
    ALTITUDE_M = 100.0
    
    marseille = eph['earth'] + Topos(latitude_degrees=LATITUDE, longitude_degrees=LONGITUDE, elevation_m=ALTITUDE_M)
    
    ASTRES = {
        "SOLEIL": eph['sun'],
        "LUNE": eph['moon'],
        "JUPITER": eph['jupiter barycenter']
    }
    MAGNITUDES = {"SOLEIL": -26.74, "LUNE": -12.74, "JUPITER": -2.50}
    
    MATRICE_FINALE = {}

    for nom_astre, objet_jpl in ASTRES.items():
        MATRICE_FINALE[nom_astre] = {}
        print(f"[MUTATION VECTORIELLE] Traitement natif pour {nom_astre}...")
        
        for h in range(24):
            for m in range(60):
                cle_heure_minute = f"{h:02d}:{m:02d}"
                
                # Alignement temporel sur l'échelle de temps de précision de la NASA
                moment_calcul = ts.utc(annee, mois, jour, h, m)
                
                # Interception des coordonnées horizontales topocentriques réelles
                observation = marseille.at(moment_calcul).observe(objet_jpl)
                alt, az, distance = observation.apparent().altaz()
                
                # Calcul de la vitesse radiale relative instantanée par dérivation à +1s
                moment_calcul_plus_1s = ts.utc(annee, mois, jour, h, m, 1)
                dist_plus_1s_km = marseille.at(moment_calcul_plus_1s).observe(objet_jpl).apparent().altaz()[2].km
                vitesse_kms = dist_plus_1s_km - distance.km
                
                # Correction de réfraction
                elevation_corrigee = calculer_refraction_dynamique(alt.degrees, ALTITUDE_M)
                
                MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                    round(az.degrees, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance.au, 6),
                    round(vitesse_kms, 3)
                ]

    # Écriture finale
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[SUCCÈS METRIC] Fichier 'orbites.json' mis à jour (0% simulation, 100% JPL).")
    except Exception as e:
        print(f"[CRASH] Échec d'écriture : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
