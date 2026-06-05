#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
import requests
from skyfield.api import Topos, load

def recuperer_temps_atomique_universel():
    """
    Récupère le timestamp UNIX absolu (secondes depuis 1970) via des serveurs de temps 
    pour ignorer l'horloge locale de la machine ou d'un système Android.
    """
    try:
        # Interrogation d'une source de temps réseau standardisée (Time API)
        response = requests.get("https://worldtimeapi.org/api/timezone/Etc/UTC", timeout=5)
        if response.status_code == 200:
            data = response.json()
            return data["unixtime"]
    except Exception:
        print("[AVERTISSEMENT] Impossible de joindre le serveur NTP/HTTP. Utilisation du timestamp brut de secours.")
    
    # Sécurité si le réseau coupe : utilisation du timestamp POSIX brut (qui est indépendant du fuseau horaire)
    import time
    return int(time.time())

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
    print("[INFO] SENTINELA - Initialisation par Synchronisation Temporelle Absolue (0 Horloge Système)")
    
    if not os.path.exists('de421.bsp'):
        print("[ERREUR CRITIQUE] Le noyau JPL de421.bsp est manquant.")
        sys.exit(1)
        
    eph = load('de421.bsp')
    ts = load.timescale()
    
    # 1. Extraction de la date à partir du repère atomique UNIX (indépendant de tout fuseau politique)
    timestamp_pur = recuperer_temps_atomique_universel()
    
    # Conversion manuelle du timestamp en date UTC pure (sans passer par les fonctions de fuseaux de l'OS)
    # On utilise l'échelle de temps de Skyfield qui gère intrinsèquement les secondes intercalaires (Leap Seconds)
    moment_actuel_ts = ts.from_unix(timestamp_pur)
    annee, mois, jour, _, _, _ = moment_actuel_ts.utc
    
    print(f"[TEMPS ATOMIQUE UTC COMPILÉ] Cycle de calcul calé sur le jour astronomique : {int(annee)}-{int(mois):02d}-{int(jour):02d}")
    
    # 2. Définition des coordonnées spatiales pures (Marseille)
    # Latitude/Longitude géocentriques (coordonnées horizontales vraies)
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
        
        # Génération des 1440 points de la journée (24h * 60m)
        for h in range(24):
            for m in range(60):
                cle_heure_minute = f"{h:02d}:{m:02d}"
                
                # Conversion directe en temps universel de la NASA (0 intermédiaire politique ou régional)
                moment_calcul = ts.utc(int(annee), int(mois), int(jour), h, m)
                
                # Observation vectorielle topocentrique
                observation = marseille.at(moment_calcul).observe(objet_jpl)
                alt, az, distance = observation.apparent().altaz()
                
                # Dérivation pour la vitesse radiale exacte (1 seconde d'intervalle)
                moment_calcul_plus_1s = ts.utc(int(annee), int(mois), int(jour), h, m, 1)
                dist_plus_1s = marseille.at(moment_calcul_plus_1s).observe(objet_jpl).apparent().altaz()[2].km
                vitesse_kms = dist_plus_1s - distance.km
                
                # Correction de l'enveloppe atmosphérique locale
                elevation_corrigee = calculer_refraction_dynamique(alt.degrees, ALTITUDE_M)
                
                MATRICE_FINALE[nom_astre][cle_heure_minute] = [
                    round(az.degrees, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance.au, 6),
                    round(vitesse_kms, 3)
                ]
                
    # Écriture du fichier orbites.json
    with open("orbites.json", "w", encoding="utf-8") as f:
        json.dump(MATRICE_FINALE, f, indent=4, ensure_ascii=False)
    print("[MIGRATION EFFECTUÉE] Alignement vectoriel découplé de l'environnement matériel et politique.")

if __name__ == "__main__":
    executer_acquisition()
