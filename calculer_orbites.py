#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
import time
from datetime import datetime, timezone
from skyfield.api import Topos, load

# Chargement unique et persistant du noyau de la NASA en mémoire RAM
if not os.path.exists('de421.bsp'):
    print("[ERREUR CRITIQUE] Fichier de421.bsp absent du répertoire d'exécution.")
    sys.exit(1)

EPH = load('de421.bsp')
TS = load.timescale()

ASTRES = {
    "SOLEIL": EPH['sun'],
    "LUNE": EPH['moon'],
    "JUPITER": EPH['jupiter barycenter']
}
MAGNITUDES = {"SOLEIL": -26.74, "LUNE": -12.74, "JUPITER": -2.50}

def capter_gnss_et_environnement(timestamp_depart, index_frame):
    """
    Simulation d'acquisition du récepteur GNSS (GPS/Galileo) du Samsung S10e.
    Simule un déplacement linéaire à 999 km/h (277.5 m/s) à 9 500 mètres d'altitude.
    """
    # Intervalle théorique 60 Hz : 0.016666 secondes par frame
    dt_cadre = 1.0 / 60.0
    timestamp_atomique = timestamp_depart + (index_frame * dt_cadre)
    
    # Cinématique à 999 km/h (Cap Est constant : la longitude augmente)
    vitesse_deg_par_seconde = 0.00356 
    lat_actuelle = 43.2891
    lon_actuelle = 5.3572 + (index_frame * dt_cadre * vitesse_deg_par_seconde)
    alt_gnss_m = 9500.0  # Altitude de croisière stable (en mètres)
    
    # Facteur de transparence physique issu du capteur optique RGB (1.0 = Ciel pur)
    transparence_rgb = 1.0 
    
    return timestamp_atomique, lat_actuelle, lon_actuelle, alt_gnss_m, transparence_rgb

def calculer_pression_externe_reelle(altitude_gnss_m):
    """
    Modélisation hydrostatique standard de l'atmosphère (OACI).
    Calcule la pression de l'air réelle à l'extérieur de la carlingue.
    """
    if altitude_gnss_m < 11000.0:
        return 1013.25 * math.pow(1.0 - (0.0065 * altitude_gnss_m) / 288.15, 5.255)
    else:
        return 226.32 * math.exp(-0.00015769 * (altitude_gnss_m - 11000.0))

def calculer_refraction_dynamique_uhf(altitude_brute_deg, altitude_gnss_m, facteur_transparence):
    """
    Algorithme de Bennett (NASA) optimisé pour l'environnement cinématique haute altitude.
    """
    if altitude_brute_deg <= 0.0:
        return altitude_brute_deg
        
    pression_externe = calculer_pression_externe_reelle(altitude_gnss_m)
    temp_k = (288.15 - (0.0065 * altitude_gnss_m)) if altitude_gnss_m < 11000.0 else 216.65
    
    angle_rad = math.radians(altitude_brute_deg + (7.31 / (altitude_brute_deg + 4.4)))
    cotangente = 1.0 / math.tan(angle_rad)
    
    facteur_densite_air = (pression_externe / 1013.25) * (288.15 / temp_k)
    correction_deg = (cotangente / 60.0) * facteur_densite_air * facteur_transparence
    
    return altitude_brute_deg + correction_deg

def executer_moteur_60hz():
    TARGET_HZ = 60
    BUDGET_CADRE = 1.0 / TARGET_HZ  # ~0.016666667 s
    
    print(f"[INITIALISATION] SENTINELA UHF v8.9.9b - Fréquence d'Échantillonnage : {TARGET_HZ} Hz")
    print("[MÉTHODE] Vectorisation instantanée 3D & Différenciation Cinématique Arrière.")
    
    # Mémoire tampon de la frame précédente (t-1)
    historique_distances_km = {astre: None for astre in ASTRES}
    timestamp_precedent = None
    
    # Ancrage initial sur le temps GNSS actuel
    timestamp_zero = time.time()
    frame_index = 0
    
    try:
        while True:
            top_debut = time.perf_counter()
            
            # 1. Extraction immédiate de la position 3D spatio-temporelle à 999 km/h
            t_atomique, lat, lon, alt_m, transparence = capter_gnss_et_environnement(timestamp_zero, frame_index)
            
            # Alignement de l'échelle de temps de la NASA (Skyfield) sur les microsecondes GNSS
            moment_utc = datetime.fromtimestamp(t_atomique, tz=timezone.utc)
            moment_skyfield = TS.from_datetime(moment_utc)
            
            # Positionnement du nœud mobile tridimensionnel
            position_mobile = EPH['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon, elevation_m=alt_m)
            
            flux_frame = {
                "CLOCK_3D": {
                    "utc_gnss_atomique": moment_utc.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],
                    "coordonnees": {"lat": round(lat, 5), "lon": round(lon, 5), "alt_m": round(alt_m, 1)},
                    "cadence_hz": TARGET_HZ
                }
            }
            
            # Évaluation de l'intervalle temporel réel écoulé
            delta_t = (t_atomique - timestamp_precedent) if timestamp_precedent else BUDGET_CADRE
            if delta_t <= 0:
                delta_t = BUDGET_CADRE
                
            # 2. Résolution orbitale monocycle
            for nom_astre, objet_jpl in ASTRES.items():
                observation = position_mobile.at(moment_skyfield).observe(objet_jpl).apparent()
                alt, az, distance = observation.altaz()
                
                distance_actuelle_km = distance.km
                elevation_corrigee = calculer_refraction_dynamique_uhf(alt.degrees, alt_m, transparence)
                
                # Calcul de la vitesse radiale instantanée (0% surcoût CPU)
                dist_precedente = historique_distances_km[nom_astre]
                if dist_precedente is not None:
                    vitesse_radiale_kms = (distance_actuelle_km - dist_precedente) / delta_t
                else:
                    vitesse_radiale_kms = 0.0
                
                # Sauvegarde mémoire pour la frame (t+1)
                historique_distances_km[nom_astre] = distance_actuelle_km
                
                flux_frame[nom_astre] = [
                    round(az.degrees, 4),
                    round(elevation_corrigee, 4),
                    MAGNITUDES[nom_astre],
                    round(distance.au, 6),
                    round(vitesse_radiale_kms, 3)
                ]
            
            timestamp_precedent = t_atomique
            
            # Écriture ultra-compacte sans espaces (optimisation des Entrées/Sorties pour le 60 Hz)
            with open("flux_live.json", "w", encoding="utf-8") as f:
                json.dump(flux_frame, f, separators=(',', ':'))
            
            # Éjection visuelle sur la console toutes les 30 frames (~0.5 seconde) pour ne pas saturer l'I/O
            if frame_index % 30 == 0:
                print(f"[{flux_frame['CLOCK_3D']['utc_gnss_atomique']}] LON: {lon:.4f}° | SOLEIL H: {flux_frame['SOLEIL'][1]}° | VITESSE RADIALE JUPITER: {flux_frame['JUPITER'][4]} km/s")
            
            frame_index += 1
            
            # 3. Régulateur matériel matériel de précision (Anti-Jitter)
            temps_calcul = time.perf_counter() - top_debut
            temps_attente_requis = BUDGET_CADRE - temps_calcul
            
            if temps_attente_requis > 0:
                time.sleep(temps_attente_requis)
                
    except KeyboardInterrupt:
        print("\n[ARRÊT SÉCURISÉ] Interruption du cadran atomique 60 Hz.")

if __name__ == "__main__":
    executer_moteur_60hz()
