#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
import time
from skyfield.api import Topos, load

def executer_acquisition():
    print("[INFO] SENTINELA - Alignement Temporel Atomique Terrestre (0 Politique)")
    
    # Validation du noyau de calcul physique de la NASA
    if not os.path.exists('de421.bsp'):
        print("[ERREUR CRITIQUE] Le fichier de421.bsp est manquant dans l'espace de build.")
        sys.exit(1)
        
    eph = load('de421.bsp')
    ts = load.timescale()
    
    # 1. Capture du temps POSIX absolu (Horloge atomique NTP du serveur de calcul GitHub)
    # Ce timestamp est exprimé en secondes pures depuis le 1er Janvier 1970 à 00:00:00 UTC.
    # Il ignore totalement les configurations locales, les fuseaux gouvernementaux et les bugs d'appareils clients (Android).
    timestamp_unix_pur = time.time()
    
    # Conversion directe dans l'échelle de temps astronomique de la NASA
    # Skyfield applique automatiquement les corrections de secondes intercalaires (Delta T / Leap Seconds)
    moment_spatial = ts.from_unix(timestamp_unix_pur)
    annee, mois, jour, _, _, _ = moment_spatial.utc
    
    print(f"[REPERE TEMPOREL] Alignement sur la grille astronomique UTC : {int(annee)}-{int(mois):02d}-{int(jour):02d}")
    
    # 2. Coordonnées tridimensionnelles de l'antenne SENTINELA (Marseille)
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
        
        # Génération de la matrice complète des éphémérides de la journée sur une grille UTC pure
        for h in range(24):
            for m in range(60):
                cle_heure_minute = f"{h:02d}:{m:02d}"
                
                # Injection du temps universel (0 fuseau horaire politique, 0 heure d'été/hiver)
                moment_calcul = ts.utc(int(annee), int(mois), int(jour), h, m)
                
                # Interception des coordonnées vectorielles réelles du JPL
                observation = marseille.at(moment_calcul).observe(objet_jpl)
                alt, az, distance = observation.apparent().altaz()
                
                # Calcul de la vitesse radiale relative instantanée (km/s)
                moment_calcul_plus_1s = ts.utc(int(annee), int(mois), int(jour), h, m, 1)
                dist_plus_1s_km = marseille.at(moment_calcul_plus_1s).observe(objet_jpl).apparent().altaz()[2].km
                vitesse_kms = dist_plus_1s_km - distance.km
                
                # Correction de la courbure lumineuse de l'enveloppe atmosphérique locale
                if alt.degrees > -0.5:
                    pression_hpa = 1013.25 * math.pow(1.0 - (0.0065 * ALTITUDE_M) / 288.15, 5.255)
                    temperature_kelvin = 288.15 - (0.0065 * ALTITUDE_M)
                    angle_rad = (alt.degrees + 7.31 / (alt.degrees + 4.4)) * (math.pi / 180.0)
                    cotangente = 1.0 / math.tan(angle_rad)
                    correction_arcmin = (cotangente / 60.0) * (pression_hpa / 1013.25) * (288.15 / temperature_kelvin)
                    elevation_corrigee = alt.degrees + correction_arcmin
                else:
                    elevation_corrigee = alt.degrees
                
                # Compilation des données vectorielles
                MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                    round(az.degrees, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance.au, 6),
                    round(vitesse_kms, 3)
                ]

    # Écriture forcée et sécurisée de la matrice
    try:
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
        print("[MIGRATION EFFECTUÉE] Fichier 'orbites.json' verrouillé en UTC pur.")
    except Exception as e:
        print(f"[ERREUR COMPILATION] Impossible d'écrire le fichier : {e}")
        sys.exit(1)

if __name__ == "__main__":
    executer_acquisition()
