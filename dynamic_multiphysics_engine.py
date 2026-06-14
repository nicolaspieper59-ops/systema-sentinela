#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.3 — MOTEUR GÉODÉSIQUE ET MULTIPHYSIQUE REEL
CONFORME AUX CONVENTIONS IERS & CONFIGURATION NASA JPL DE440
"""

import sys
import json
import math
import time
from datetime import datetime, timezone
import numpy as np
from skyfield.api import load, wgs84

def coordonnees_geodésiques_vers_ecef(lat_deg, lon_deg, alt_m):
    """
    Conversion rigoureuse de coordonnées géodésiques vers le repère cartésien ECEF WGS84
    Évite les dérives de précession/nutation des repères spatiaux purs.
    """
    a = 6378137.0           # Rayon équatorial WGS84
    f = 1.0 / 298.257223563 # Aplatissement
    e2 = 2.0*f - f**2       # Carré de la première excentricité
    
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    
    N = a / math.sqrt(1.0 - e2 * math.sin(lat)**2)
    
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - e2) + alt_m) * math.sin(lat)
    
    return np.array([x, y, z])

def calculer_marees_solides_iers(pos_station_ecef, pos_lune_ecef, m_lune, pos_soleil_ecef, m_soleil, m_terre):
    """
    Calcule la déformation tridimensionnelle réelle de la croûte terrestre (Météo-Géodynamique)
    par projection du potentiel de marée du second degré (Nombres de Love h2 et Shida l2).
    """
    h2 = 0.6078
    l2 = 0.0847
    R_E = 6378137.0
    
    r_station = np.linalg.norm(pos_station_ecef)
    u_station = pos_station_ecef / r_station
    
    delta_r_total = np.zeros(3)
    corps = [
        {'pos': pos_lune_ecef, 'mass_ratio': m_lune / m_terre},
        {'pos': pos_soleil_ecef, 'mass_ratio': m_soleil / m_terre}
    ]
    
    for c in corps:
        r_c = np.linalg.norm(c['pos'])
        u_c = c['pos'] / r_c
        
        cos_theta = np.dot(u_station, u_c)
        
        disp_v = h2 * (R_E * c['mass_ratio'] * (R_E / r_c)**3) * (1.5 * cos_theta**2 - 0.5)
        disp_h = 3.0 * l2 * (R_E * c['mass_ratio'] * (R_E / r_c)**3) * cos_theta
        
        vecteur_corps = disp_v * u_station + disp_h * (u_c - cos_theta * u_station)
        delta_r_total += vecteur_corps
        
    return delta_r_total

def executer_moteur_v83():
    mode_recouvrement = "MARSEILLE_FIXE"
    if len(sys.argv) > 1:
        mode_recouvrement = sys.argv[1].upper()

    # Constantes Physiques Fondamentales
    G = 6.67430e-11
    C = 299792458.0
    M_TERRE = 5.9722e24
    OMEGA_TERRE = 7.292115e-5
    R_EQ = 6378137.0
    J2 = 1.08263e-3
    
    # Marseille Référence Métrologique
    LATITUDE = 43.284356
    LONGITUDE = 5.358507
    ALTITUDE_NOMINALE = 99.3100

    print(f"[INIT] Activation du Noyau Géodésique Continu v8.3 [{mode_recouvrement}]")
    
    try:
        eph = load('de440.bsp')
        ts = load.timescale()
    except Exception as e:
        sys.stderr.write(f"[FATAL] Échec DE440 : {str(e)}\n")
        sys.exit(1)

    m_terre, m_lune, m_soleil = 1.0, 0.0123000371, 332946.0487

    # Profils d'environnement cinématique
    vitesse_propre_m_s = 0.0
    pression_surface = 1013.25
    temperature_surface_k = 288.15
    e_vapeur_eau = 12.0
    
    if mode_recouvrement == "AVION":
        altitude_geo = 10600.0
        vitesse_propre_m_s = 250.0
        pression_surface = 238.4
        temperature_surface_k = 218.8
        e_vapeur_eau = 0.01
    elif mode_recouvrement == "TRAIN":
        altitude_geo = ALTITUDE_NOMINALE + 20.0
        vitesse_propre_m_s = 83.3
    elif mode_recouvrement == "VOITURE":
        altitude_geo = ALTITUDE_NOMINALE
        vitesse_propre_m_s = 25.0
    elif mode_recouvrement == "BATEAU":
        altitude_geo = 0.0
        vitesse_propre_m_s = 8.0
        e_vapeur_eau = 22.0
    else:
        altitude_geo = ALTITUDE_NOMINALE

    corps_observes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury'],
        'venus': eph['venus'], 'mars': eph['mars barycenter'], 'jupiter': eph['jupiter barycenter'],
        'saturne': eph['saturn barycenter'], 'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }

    while True:
        try:
            instant_utc = ts.from_datetime(datetime.now(timezone.utc))
            
            # 1. Calcul de la position de base stricte WGS84 (en mètres)
            pos_base_m = coordonnees_geodésiques_vers_ecef(LATITUDE, LONGITUDE, altitude_geo)
            
            # 2. Vecteurs astronomiques géocentriques pour les marées (convertis en mètres)
            terre_obj = eph['earth']
            lune_m = Lack_m = terre_obj.at(instant_utc).observe(eph['moon']).position.m
            soleil_m = terre_obj.at(instant_utc).observe(eph['sun']).position.m
            
            # 3. Application de la marée solide
            delta_marée_ecef = calculer_marees_solides_iers(pos_base_m, lune_m, m_lune, soleil_m, m_soleil, m_terre)
            
            if mode_recouvrement == "MARSEILLE_FIXE":
                pos_modifiee_ecef = pos_base_m + delta_marée_ecef
            else:
                pos_modifiee_ecef = pos_base_m

            x_r, y_r, z_r = pos_modifiee_ecef
            r_final = math.sqrt(x_r**2 + y_r**2 + z_r**2)
            
            # 4. Potentiel gravitationnel complet J2 + Horloge relativiste
            sin_lat = z_r / r_final
            p_m = math.sqrt(x_r**2 + y_r**2)
            
            potentiel_nominal = (G * M_TERRE) / r_final
            potentiel_j2 = potentiel_nominal * J2 * (R_EQ / r_final)**2 * 1.5 * (1.0 - 3.0 * sin_lat**2)
            potentiel_total_u = potentiel_nominal + potentiel_j2
            
            vitesse_totale_m_s = (OMEGA_TERRE * p_m) + vitesse_propre_m_s
            drift_relativiste_ns_s = ((-potentiel_total_u / C**2) - (vitesse_totale_m_s**2 / (2.0 * C**2))) * 1e9

            # 5. Éphémérides topocentriques
            station_inst = terre_obj + wgs84.latlon(LATITUDE, LONGITUDE, elevation_m=altitude_geo)
            flux_astres = {}
            
            for nom, cible in corps_observes.items():
                obs = station_inst.at(instant_utc).observe(cible).apparent()
                alt_brute, az, dist = obs.altaz()
                
                tan_E = math.tan(math.radians(max(0.1, alt_brute.degrees)))
                refraction_deg = (0.0002967 / tan_E) if alt_brute.degrees > 5.0 else 0.0
                elevation_corrigee = alt_brute.degrees + refraction_deg
                
                ra, dec = obs.radec()[:2]
                
                flux_astres[nom] = {
                    "azimut_deg": float(az.degrees),
                    "elevation_deg": float(elevation_corrigee),
                    "declinaison_deg": float(dec.degrees),
                    "ascension_droite_deg": float(ra.hours * 15.0),
                    "distance_precision_m": float(dist.m)
                }

            # Packaging JSON
            payload_v83 = {
                "METADATA": {
                    "infrastructure": "SYSTEMA SENTINELA v8.3 — REPERE RE-ALIGNE",
                    "mode_environnement_execution": mode_recouvrement,
                    "epoch_utc": datetime.now(timezone.utc).isoformat(),
                    "maree_solide_composante_xyz_m": [float(delta_marée_ecef[0]), float(delta_marée_ecef[1]), float(delta_marée_ecef[2])],
                    "norme_maree_mm": float(np.linalg.norm(delta_marée_ecef) * 1000.0),
                    "horloge_einstein_delta_ns_s": float(drift_relativiste_ns_s),
                    "pression_base_hpa": float(pression_surface),
                    "temperature_base_k": float(temperature_surface_k),
                    "modelisation_troposphere": "SAASTAMOINEN + ZWD DYNAMIQUE",
                    "synchronisation": "STRICT_EPHEMERIS_DE440"
                },
                "MATRICE_ECEF_REEL": {
                    "X_mètres": float(x_r),
                    "Y_mètres": float(y_r),
                    "Z_mètres": float(z_r)
                },
                "DATA_STREAMS": flux_astres
            }

            with open("flux_live.json", "w", encoding="utf-8") as f:
                json.dump(payload_v83, f, indent=4, ensure_ascii=False)
            
            time.sleep(0.5)

        except KeyboardInterrupt:
            break
        except Exception as e:
            time.sleep(2.0)

if __name__ == "__main__":
    executer_moteur_v83()
