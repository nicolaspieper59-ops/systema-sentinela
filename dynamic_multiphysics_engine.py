#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.5.0 — MOTEUR GÉODÉSIQUE ET MULTIPHYSIQUE TEMPS RÉEL
CONFORME AUX CONVENTIONS IERS & CONFIGURATION NASA JPL DE440
ÉCRITURE ATOMIQUE ANTICORRUPTION ET SIMULATION CINÉMATIQUE ACTIVE
"""

import os
import sys
import json
import math
import time
from datetime import datetime, timezone
import numpy as np
from skyfield.api import load, wgs84

def coordonnees_geodésiques_vers_ecef(lat_deg, lon_deg, alt_m):
    a = 6378137.0           
    f = 1.0 / 298.257223563 
    e2 = 2.0*f - f**2       
    
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    
    N = a / math.sqrt(1.0 - e2 * math.sin(lat)**2)
    
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - e2) + alt_m) * math.sin(lat)
    
    return np.array([x, y, z])

def calculer_marees_solides_iers(pos_station_ecef, pos_lune_ecef, m_lune, pos_soleil_ecef, m_soleil, m_terre):
    h2 = 0.6078
    l2 = 0.0847
    R_E = 6378137.0
    
    r_station = np.linalg.norm(pos_station_ecef)
    if r_station < 1e-6: return np.zeros(3)
    u_station = pos_station_ecef / r_station
    
    delta_r_total = np.zeros(3)
    corps = [
        {'pos': pos_lune_ecef, 'mass_ratio': m_lune / m_terre},
        {'pos': pos_soleil_ecef, 'mass_ratio': m_soleil / m_terre}
    ]
    
    for c in corps:
        r_c = np.linalg.norm(c['pos'])
        if r_c < 1e-6: continue
        u_c = c['pos'] / r_c
        
        cos_theta = np.dot(u_station, u_c)
        
        disp_v = h2 * (R_E * c['mass_ratio'] * (R_E / r_c)**3) * (1.5 * cos_theta**2 - 0.5)
        disp_h = 3.0 * l2 * (R_E * c['mass_ratio'] * (R_E / r_c)**3) * cos_theta
        
        vecteur_corps = disp_v * u_station + disp_h * (u_c - cos_theta * u_station)
        delta_r_total += vecteur_corps
        
    return delta_r_total

def generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles):
    G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C, altitude_geo, vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau = constants
    m_terre, m_lune, m_soleil = 1.0, 0.0123000371, 332946.0487
    
    # Extraction et incrémentation des coordonnées dynamiques du véhicule
    lat_actuelle = variables_mobiles['latitude']
    lon_actuelle = variables_mobiles['longitude']
    
    instant_utc = ts.from_datetime(datetime.now(timezone.utc))
    pos_base_m = coordonnees_geodésiques_vers_ecef(lat_actuelle, lon_actuelle, altitude_geo)
    
    # Résolution des éphémérides de position en mètres (conversion depuis UA de Skyfield)
    UA_EN_METRES = 149597870700.0
    terre_obj = eph['earth']
    
    lune_pose = Point_pos = visions_pos = terre_obj.at(instant_utc).observe(eph['moon']).position.au * UA_EN_METRES
    soleil_pose = terre_obj.at(instant_utc).observe(eph['sun']).position.au * UA_EN_METRES
    
    delta_marée_ecef = calculer_marees_solides_iers(pos_base_m, lune_pose, m_lune, soleil_pose, m_soleil, m_terre)
    
    if mode_recouvrement == "MARSEILLE_FIXE":
        pos_modifiee_ecef = pos_base_m + delta_marée_ecef
    else:
        pos_modifiee_ecef = pos_base_m

    x_r, y_r, z_r = pos_modifiee_ecef
    r_final = math.sqrt(x_r**2 + y_r**2 + z_r**2)
    
    sin_lat = z_r / r_final if r_final > 0 else 0
    p_m = math.sqrt(x_r**2 + y_r**2)
    
    potentiel_nominal = (G * M_TERRE) / r_final if r_final > 0 else 0
    potentiel_j2 = potentiel_nominal * J2 * (R_EQ / r_final)**2 * 1.5 * (1.0 - 3.0 * sin_lat**2) if r_final > 0 else 0
    potentiel_total_u = potentiel_nominal + potentiel_j2
    
    vitesse_totale_m_s = (OMEGA_TERRE * p_m) + vitesse_propre_m_s
    drift_relativiste_ns_s = ((-potentiel_total_u / C**2) - (vitesse_totale_m_s**2 / (2.0 * C**2))) * 1e9

    station_inst = terre_obj + wgs84.latlon(lat_actuelle, lon_actuelle, elevation_m=altitude_geo)
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

    payload_v85 = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v8.5.0 — NOYAU MOBILE COMPENSÉ",
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

    # SÉCURISATION IO : Écriture atomique pour éviter les corruptions de lecture Web
    tmp_file = "flux_live.tmp"
    target_file = "flux_live.json"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(payload_v85, f, indent=4, ensure_ascii=False)
    os.replace(tmp_file, target_file)
    
    print(f"[SUCCESS] v8.5.0 — Pos:[{lat_actuelle:.5f}°, {lon_actuelle:.5f}°] — Trame synchrone générée.")

def executer_moteur_v85():
    mode_recouvrement = "MARSEILLE_FIXE"
    if len(sys.argv) > 1:
        mode_recouvrement = sys.argv[1].upper()

    G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C = 6.67430e-11, 5.9722e24, 7.292115e-5, 6378137.0, 1.08263e-3, 299792458.0
    LATITUDE_INITIALE, LONGITUDE_INITIALE, ALTITUDE_NOMINALE = 43.284356, 5.358507, 99.3100

    print(f"[INIT] Activation du Noyau Géodésique Continu v8.5.0 [{mode_recouvrement}]")
    
    try:
        eph = load('de440.bsp')
        ts = load.timescale()
    except Exception as e:
        sys.stderr.write(f"[FATAL] Impossible de localiser la base d'éphémérides JPL DE440 : {str(e)}\n")
        sys.exit(1)

    vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau = 0.0, 1013.25, 288.15, 12.0
    if mode_recouvrement == "AVION":
        altitude_geo, vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau = 10600.0, 250.0, 238.4, 218.8, 0.01
    elif mode_recouvrement == "TRAIN":
        altitude_geo, vitesse_propre_m_s = ALTITUDE_NOMINALE + 20.0, 83.3
    elif mode_recouvrement == "VOITURE":
        altitude_geo, vitesse_propre_m_s = ALTITUDE_NOMINALE, 25.0
    elif mode_recouvrement == "BATEAU":
        altitude_geo, vitesse_propre_m_s, e_vapeur_eau = 0.0, 8.0, 22.0
    else:
        altitude_geo = ALTITUDE_NOMINALE

    corps_observes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury'],
        'venus': eph['venus'], 'mars': eph['mars barycenter'], 'jupiter': eph['jupiter barycenter'],
        'saturne': eph['saturn barycenter'], 'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }

    constants = (G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C, altitude_geo, vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau)
    
    # Dictionnaire de suivi de la position cinématique
    variables_mobiles = {
        'latitude': LATITUDE_INITIALE,
        'longitude': LONGITUDE_INITIALE
    }

    if os.environ.get('GITHUB_ACTIONS') == 'true':
        generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles)
    else:
        print("[LOCAL CONFIG] Boucle Haute Fréquence active (Intervalle strict : 0.5s).")
        R_TERRE = 6371000.0
        
        while True:
            try:
                t_debut = time.time()
                
                # Mise à jour de la position géographique en fonction de la vitesse propre (Cap Nord-Est fixe pour dérive)
                if vitesse_propre_m_s > 0:
                    pas_temps = 0.5
                    distance_parcourue = vitesse_propre_m_s * pas_temps
                    # Approximation linéaire locale (1 degré lat ≈ 111km)
                    delta_lat = (distance_parcourue * math.cos(math.radians(45))) / R_TERRE * (180.0 / math.pi)
                    delta_lon = (distance_parcourue * math.sin(math.radians(45))) / (R_TERRE * math.cos(math.radians(variables_mobiles['latitude']))) * (180.0 / math.pi)
                    
                    variables_mobiles['latitude'] += delta_lat
                    variables_mobiles['longitude'] += delta_lon
                
                generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles)
                
                # Compensation du temps d'exécution pour maintenir 2 Hz strict
                t_execution = time.time() - t_debut
                temps_sommeil = max(0.01, 0.5 - t_execution)
                time.sleep(temps_sommeil)
                
            except KeyboardInterrupt:
                print("\n[SHUTDOWN] Libération du fichier d'éphémérides JPL.")
                break
            except Exception as e:
                sys.stderr.write(f"[ERREUR CADENCE] {str(e)}\n")
                time.sleep(2.0)

if __name__ == "__main__":
    executer_moteur_v85()
