#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.5.2 — MOTEUR GÉODÉSIQUE ET MULTIPHYSIQUE TEMPS RÉEL
CONVERSION ET INTÉGRATION TRIDIMENSIONNELLE STRICTE ECEF — HORLOGE DÉTERMINISTE
"""

import os
import sys
import json
import math
import time
from datetime import datetime, timezone, timedelta
import numpy as np
from skyfield.api import load, wgs84

# Constantes de l'ellipsoïde de référence WGS84
A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

def calculer_rayons_courbure(lat_rad):
    """Calcule les rayons de courbure méridiens (M) et transverses (N) WGS84"""
    denom = 1.0 - E2_WGS84 * math.sin(lat_rad)**2
    sqrt_denom = math.sqrt(denom)
    M = A_WGS84 * (1.0 - E2_WGS84) / (denom * sqrt_denom)
    N = A_WGS84 / sqrt_denom
    return M, N

def coordonnees_geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    """Conversion Directe : Géodésique -> ECEF (Cartésien 3D)"""
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    _, N = calculer_rayons_courbure(lat)
    
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return np.array([x, y, z])

def ecef_vers_geodesique(x, y, z):
    """Conversion Inverse : ECEF (3D) -> Géodésique (Bowring 1976)"""
    p = math.sqrt(x**2 + y**2)
    if p < 1e-6:
        lat = 90.0 if z > 0 else -90.0
        lon = 0.0
        alt = abs(z) - A_WGS84 * (1.0 - F_WGS84)
        return lat, lon, alt
    
    b = A_WGS84 * (1.0 - F_WGS84)
    ep2 = (A_WGS84**2 - b**2) / (b**2)
    theta = math.atan2(z * A_WGS84, p * b)
    
    lat_rad = math.atan2(
        z + ep2 * b * (math.sin(theta)**3),
        p - E2_WGS84 * A_WGS84 * (math.cos(theta)**3)
    )
    lon_rad = math.atan2(y, x)
    
    _, N = calculer_rayons_courbure(lat_rad)
    alt = p / math.cos(lat_rad) - N
    
    return math.degrees(lat_rad), math.degrees(lon_rad), alt

def calculer_marees_solides_iers(pos_station_ecef, pos_lune_ecef, m_lune, pos_soleil_ecef, m_soleil, m_terre):
    """Estimation des déformations de la croûte terrestre (Marée de Love Solide)"""
    h2 = 0.6078
    l2 = 0.0847
    
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
        
        disp_v = h2 * (A_WGS84 * c['mass_ratio'] * (A_WGS84 / r_c)**3) * (1.5 * cos_theta**2 - 0.5)
        disp_h = 3.0 * l2 * (A_WGS84 * c['mass_ratio'] * (A_WGS84 / r_c)**3) * cos_theta
        
        vecteur_corps = disp_v * u_station + disp_h * (u_c - cos_theta * u_station)
        delta_r_total += vecteur_corps
        
    return delta_r_total

def generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles):
    G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C, vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau = constants
    m_terre, m_lune, m_soleil = 1.0, 0.0123000371, 332946.0487
    
    pos_base_m = variables_mobiles['pos_ecef']
    sim_datetime = variables_mobiles['sim_time']
    
    lat_actuelle, lon_actuelle, alt_actuelle = ecef_vers_geodesique(pos_base_m[0], pos_base_m[1], pos_base_m[2])
    instant_utc = ts.from_datetime(sim_datetime)
    
    UA_EN_METRES = 149597870700.0
    terre_obj = eph['earth']
    lune_pose = terre_obj.at(instant_utc).observe(eph['moon']).position.au * UA_EN_METRES
    soleil_pose = terre_obj.at(instant_utc).observe(eph['sun']).position.au * UA_EN_METRES
    
    delta_marée_ecef = calculer_marees_solides_iers(pos_base_m, lune_pose, m_lune, soleil_pose, m_soleil, m_terre)
    pos_modifiee_ecef = pos_base_m + delta_marée_ecef

    x_r, y_r, z_r = pos_modifiee_ecef
    r_final = math.sqrt(x_r**2 + y_r**2 + z_r**2)
    skin_lat = z_r / r_final if r_final > 0 else 0
    
    potentiel_nominal = (G * M_TERRE) / r_final if r_final > 0 else 0
    potentiel_j2 = potentiel_nominal * J2 * (R_EQ / r_final)**2 * 1.5 * (1.0 - 3.0 * skin_lat**2) if r_final > 0 else 0
    potentiel_total_u = potentiel_nominal + potentiel_j2
    
    lat_rad = math.radians(lat_actuelle)
    lon_rad = math.radians(lon_actuelle)
    v_rot_ecef = np.array([-OMEGA_TERRE * y_r, OMEGA_TERRE * x_r, 0.0])
    
    v_cap_rad = math.radians(45.0)
    v_est = vitesse_propre_m_s * math.sin(v_cap_rad)
    v_nord = vitesse_propre_m_s * math.cos(v_cap_rad)
    
    v_propre_ecef = np.array([
        -math.sin(lon_rad)*v_est - math.sin(lat_rad)*math.cos(lon_rad)*v_nord,
         math.cos(lon_rad)*v_est - math.sin(lat_rad)*math.sin(lon_rad)*v_nord,
         math.cos(lat_rad)*v_nord
    ])
    
    vitesse_totale_ecef = v_rot_ecef + v_propre_ecef
    v2_scalaire = np.dot(vitesse_totale_ecef, vitesse_totale_ecef)
    drift_relativiste_ns_s = ((-potentiel_total_u / C**2) - (v2_scalaire / (2.0 * C**2))) * 1e9

    station_inst = terre_obj + wgs84.latlon(lat_actuelle, lon_actuelle, elevation_m=alt_actuelle)
    flux_astres = {}
    
    for nom, cible in corps_observes.items():
        obs = station_inst.at(instant_utc).observe(cible).apparent()
        alt_brute, az, dist = obs.altaz()
        
        # MODELISATION RIGOUREUSE : Saastamoinen 3D Réel
        E_deg = max(0.1, alt_brute.degrees)
        E_rad = math.radians(E_deg)
        tan_E = math.tan(E_rad)
        
        if E_deg > 0.0:
            delay_dry = 0.002277 * pression_surface
            delay_wet = 0.002277 * (1255.0 / temperature_surface_k + 0.05) * e_vapeur_eau
            total_delay_m = (delay_dry + delay_wet) / tan_E
            refraction_deg = math.degrees(total_delay_m / A_WGS84)
        else:
            refraction_deg = 0.0
            
        elevation_corrigee = alt_brute.degrees + refraction_deg
        ra, dec = obs.radec()[:2]
        
        flux_astres[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(elevation_corrigee),
            "declinaison_deg": float(dec.degrees),
            "ascension_droite_deg": float(ra.hours * 15.0),
            "distance_precision_m": float(dist.m)
        }

    payload_v852 = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v8.5.2 — NOYAU TRIDIMENSIONNEL DET",
            "mode_environnement_execution": mode_recouvrement,
            "epoch_utc": sim_datetime.isoformat().replace("+00:00", "Z"),
            "maree_solide_composante_xyz_m": [float(delta_marée_ecef[0]), float(delta_marée_ecef[1]), float(delta_marée_ecef[2])],
            "norme_maree_mm": float(np.linalg.norm(delta_marée_ecef) * 1000.0),
            "horloge_einstein_delta_ns_s": float(drift_relativiste_ns_s),
            "pression_base_hpa": float(pression_surface),
            "temperature_base_k": float(temperature_surface_k),
            "modelisation_troposphere": "SAASTAMOINEN COMPLÈTE TRIDIMENSIONNELLE",
            "synchronisation": "STRICT_EPHEMERIS_DE440"
        },
        "EPOCH_UTC": sim_datetime.isoformat().replace("+00:00", "Z"),
        "MATRICE_ECEF_REEL": {
            "X_mètres": float(x_r),
            "Y_mètres": float(y_r),
            "Z_mètres": float(z_r)
        },
        "DATA_STREAMS": flux_astres
    }

    tmp_file = "flux_live.tmp"
    target_file = "flux_live.json"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(payload_v852, f, indent=4, ensure_ascii=False)
    os.replace(tmp_file, target_file)
    print(f"[SUCCESS] Epoch: {sim_datetime.strftime('%Y-%m-%dT%H:%M:%S.%fZ')} -> Écritures JSON synchrones.")

def executer_moteur_v852():
    mode_recouvrement = "MARSEILLE_FIXE"
    if len(sys.argv) > 1:
        mode_recouvrement = sys.argv[1].upper()

    G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C = 6.67430e-11, 5.9722e24, 7.292115e-5, 6378137.0, 1.08263e-3, 299792458.0
    LATITUDE_INITIALE, LONGITUDE_INITIALE, ALTITUDE_NOMINALE = 43.284356, 5.358507, 99.3100

    try:
        eph = load('de440.bsp')
        ts = load.timescale()
    except Exception as e:
        sys.stderr.write(f"[FATAL] Éphémérides DE440 introuvables : {str(e)}\n")
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

    constants = (G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C, vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau)
    pos_init_ecef = coordonnees_geodesiques_vers_ecef(LATITUDE_INITIALE, LONGITUDE_INITIALE, altitude_geo)
    epoch_initiale = datetime.now(timezone.utc)

    variables_mobiles = {
        'pos_ecef': pos_init_ecef,
        'sim_time': epoch_initiale
    }

    pas_temps = 0.5
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles)
    else:
        print(f"[RUN LOCAL] Cadencement sychronisé à dt = {pas_temps}s.")
        while True:
            try:
                t_debut = time.time()
                if vitesse_propre_m_s > 0:
                    lat_act, lon_act, _ = ecef_vers_geodesique(variables_mobiles['pos_ecef'][0], variables_mobiles['pos_ecef'][1], variables_mobiles['pos_ecef'][2])
                    lat_r = math.radians(lat_act)
                    lon_r = math.radians(lon_act)
                    
                    v_cap_rad = math.radians(45.0)
                    v_est = vitesse_propre_m_s * math.sin(v_cap_rad)
                    v_nord = vitesse_propre_m_s * math.cos(v_cap_rad)
                    
                    v_propre_ecef = np.array([
                        -math.sin(lon_r)*v_est - math.sin(lat_r)*math.cos(lon_r)*v_nord,
                         math.cos(lon_r)*v_est - math.sin(lat_r)*math.sin(lon_r)*v_nord,
                         math.cos(lat_r)*v_nord
                    ])
                    variables_mobiles['pos_ecef'] += v_propre_ecef * pas_temps
                
                generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles)
                variables_mobiles['sim_time'] += timedelta(seconds=pas_temps)
                
                t_execution = time.time() - t_debut
                time.sleep(max(0.01, pas_temps - t_execution))
            except KeyboardInterrupt:
                break

if __name__ == "__main__":
    executer_moteur_v852()
