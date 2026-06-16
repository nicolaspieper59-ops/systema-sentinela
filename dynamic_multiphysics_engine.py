#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.5.2 — MOTEUR MULTIPHYSIQUE STREAMING TEMPS RÉEL (RAM)
ÉPHÉMÉRIDES JPL DE440 & FLUX WEBSOCKET ZERO-LATENCY EN DIRECT
"""

import sys
import json
import math
import asyncio
import websockets
from datetime import datetime, timezone, timedelta
import numpy as np
from skyfield.api import load, wgs84

# Constantes de l'ellipsoïde de référence WGS84
A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2

# Variables d'état globales du porteur dynamique
MODE_PROFIL = "MARSEILLE_FIXE"
VARIABLES_MOBILES = {
    'pos_ecef': np.array([4493433.0, 420228.0, 4351944.0]), # Marseille initial
    'sim_time': datetime.now(timezone.utc)
}
CONSTANTS_PHYSIQUES = {}

def calculer_rayons_courbure(lat_rad):
    denom = 1.0 - E2_WGS84 * math.sin(lat_rad)**2
    sqrt_denom = math.sqrt(denom)
    return A_WGS84 * (1.0 - E2_WGS84) / (denom * sqrt_denom), A_WGS84 / sqrt_denom

def geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    _, N = calculer_rayons_courbure(lat)
    return np.array([
        (N + alt_m) * math.cos(lat) * math.cos(lon),
        (N + alt_m) * math.cos(lat) * math.sin(lon),
        (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    ])

def ecef_vers_geodesique(x, y, z):
    p = math.sqrt(x**2 + y**2)
    if p < 1e-6:
        return 90.0 if z > 0 else -90.0, 0.0, abs(z) - A_WGS84 * (1.0 - F_WGS84)
    b = A_WGS84 * (1.0 - F_WGS84)
    ep2 = (A_WGS84**2 - b**2) / (b**2)
    theta = math.atan2(z * A_WGS84, p * b)
    lat_rad = math.atan2(z + ep2 * b * (math.sin(theta)**3), p - E2_WGS84 * A_WGS84 * (math.cos(theta)**3))
    lon_rad = math.atan2(y, x)
    _, N = calculer_rayons_courbure(lat_rad)
    return math.degrees(lat_rad), math.degrees(lon_rad), p / math.cos(lat_rad) - N

def calculer_marees_solides_iers(pos_station_ecef, pos_lune_ecef, pos_soleil_ecef):
    h2, l2 = 0.6078, 0.0847
    r_station = np.linalg.norm(pos_station_ecef)
    if r_station < 1e-6: return np.zeros(3)
    u_station = pos_station_ecef / r_station
    
    delta_r_total = np.zeros(3)
    corps = [
        {'pos': pos_lune_ecef, 'mass_ratio': 0.0123000371},
        {'pos': pos_soleil_ecef, 'mass_ratio': 332946.0487}
    ]
    for c in corps:
        r_c = np.linalg.norm(c['pos'])
        if r_c < 1e-6: continue
        u_c = c['pos'] / r_c
        cos_theta = np.dot(u_station, u_c)
        disp_v = h2 * (A_WGS84 * c['mass_ratio'] * (A_WGS84 / r_c)**3) * (1.5 * cos_theta**2 - 0.5)
        disp_h = 3.0 * l2 * (A_WGS84 * c['mass_ratio'] * (A_WGS84 / r_c)**3) * cos_theta
        delta_r_total += disp_v * u_station + disp_h * (u_c - cos_theta * u_station)
    return delta_r_total

def generer_payload_metrologique(ts, eph, corps_observes):
    global VARIABLES_MOBILES, CONSTANTS_PHYSIQUES, MODE_PROFIL
    
    G, M_TERRE, OMEGA_TERRE, J2, C, v_propre, p_surf, t_surf, e_vapeur = CONSTANTS_PHYSIQUES.values()
    
    pos_base_m = VARIABLES_MOBILES['pos_ecef']
    sim_datetime = datetime.now(timezone.utc) # Forçage au Temps Présent Réel
    VARIABLES_MOBILES['sim_time'] = sim_datetime
    
    lat_act, lon_act, alt_act = ecef_vers_geodesique(pos_base_m[0], pos_base_m[1], pos_base_m[2])
    instant_utc = ts.from_datetime(sim_datetime)
    
    UA_METRES = 149597870700.0
    earth = eph['earth']
    lune_pose = earth.at(instant_utc).observe(eph['moon']).position.au * UA_METRES
    soleil_pose = earth.at(instant_utc).observe(eph['sun']).position.au * UA_METRES
    
    delta_maree = calculer_marees_solides_iers(pos_base_m, lune_pose, soleil_pose)
    pos_modifiee_ecef = pos_base_m + delta_maree

    x_r, y_r, z_r = pos_modifiee_ecef
    r_f = math.sqrt(x_r**2 + y_r**2 + z_r**2)
    skin_lat = z_r / r_f if r_f > 0 else 0
    
    u_nominal = (G * M_TERRE) / r_f if r_f > 0 else 0
    u_j2 = u_nominal * J2 * (A_WGS84 / r_f)**2 * 1.5 * (1.0 - 3.0 * skin_lat**2) if r_f > 0 else 0
    
    v_rot = np.array([-OMEGA_TERRE * y_r, OMEGA_TERRE * x_r, 0.0])
    lat_r, lon_r = math.radians(lat_act), math.radians(lon_act)
    v_est = v_propre * math.sin(math.radians(45.0))
    v_nord = v_propre * math.cos(math.radians(45.0))
    
    v_pr = np.array([
        -math.sin(lon_r)*v_est - math.sin(lat_r)*math.cos(lon_r)*v_nord,
         math.cos(lon_r)*v_est - math.sin(lat_r)*math.sin(lon_r)*v_nord,
         math.cos(lat_r)*v_nord
    ])
    
    v2_sc = np.dot(v_rot + v_pr, v_rot + v_pr)
    drift_relativiste = ((-(u_nominal + u_j2) / C**2) - (v2_sc / (2.0 * C**2))) * 1e9

    station = earth + wgs84.latlon(lat_act, lon_act, elevation_m=alt_act)
    flux_astres = {}
    
    for nom, cible in corps_observes.items():
        obs = station.at(instant_utc).observe(cible).apparent()
        alt_b, az, dist = obs.altaz()
        
        E_deg = max(0.1, alt_b.degrees)
        tan_E = math.tan(math.radians(E_deg))
        
        delay_dry = 0.002277 * p_surf
        delay_wet = 0.002277 * (1255.0 / t_surf + 0.05) * e_vapeur
        refraction_deg = math.degrees((delay_dry + delay_wet) / tan_E / A_WGS84)
        
        ra, dec = obs.radec()[:2]
        flux_astres[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(alt_b.degrees + refraction_deg),
            "declinaison_deg": float(dec.degrees),
            "ascension_droite_deg": float(ra.hours * 15.0),
            "distance_precision_m": float(dist.m)
        }

    return {
        "METADATA": {
            "mode_environnement_execution": MODE_PROFIL,
            "epoch_utc": sim_datetime.isoformat().replace("+00:00", "Z"),
            "norme_maree_mm": float(np.linalg.norm(delta_maree) * 1000.0),
            "horloge_einstein_delta_ns_s": float(drift_relativiste),
            "modelisation_troposphere": "SAASTAMOINEN + ZWD DYNAMIQUE"
        },
        "EPOCH_UTC": sim_datetime.isoformat().replace("+00:00", "Z"),
        "MATRICE_ECEF_REEL": {"X_mètres": float(x_r), "Y_mètres": float(y_r), "Z_mètres": float(z_r)},
        "DATA_STREAMS": flux_astres
    }

async def handler_metrologique(websocket):
    print(f"[NET] Client connecté au flux RAM — Synchronisation active.")
    global VARIABLES_MOBILES, CONSTANTS_PHYSIQUES, MODE_PROFIL
    
    try:
        eph = load('de440.bsp')
        ts = load.timescale()
    except Exception as e:
        print(f"[FATAL] Éphémérides DE440 introuvables : {e}")
        return

    corps_observes = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury'],
        'venus': eph['venus'], 'mars': eph['mars barycenter'], 'jupiter': eph['jupiter barycenter'],
        'saturne': eph['saturn barycenter'], 'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }

    dt = 0.05 # Fréquence stricte 20 Hz
    while True:
        t_start = asyncio.get_event_loop().time()
        
        # Extrapolation cinématique directe (20 Hz)
        if CONSTANTS_PHYSIQUES['vitesse_propre'] > 0:
            lat_act, lon_act, _ = ecef_vers_geodesique(VARIABLES_MOBILES['pos_ecef'][0], VARIABLES_MOBILES['pos_ecef'][1], VARIABLES_MOBILES['pos_ecef'][2])
            lat_r, lon_r = math.radians(lat_act), math.radians(lon_act)
            v_est = CONSTANTS_PHYSIQUES['vitesse_propre'] * math.sin(math.radians(45.0))
            v_nord = CONSTANTS_PHYSIQUES['vitesse_propre'] * math.cos(math.radians(45.0))
            v_pr = np.array([
                -math.sin(lon_r)*v_est - math.sin(lat_r)*math.cos(lon_r)*v_nord,
                 math.cos(lon_r)*v_est - math.sin(lat_r)*math.sin(lon_r)*v_nord,
                 math.cos(lat_r)*v_nord
            ])
            VARIABLES_MOBILES['pos_ecef'] += v_pr * dt

        # Génération RAM et envoi instantané
        payload = generer_payload_metrologique(ts, eph, corps_observes)
        try:
            await websocket.send(json.dumps(payload))
        except websockets.exceptions.ConnectionClosed:
            print("[NET] Connexion interrompue par le client.")
            break
            
        t_remis = dt - (asyncio.get_event_loop().time() - t_start)
        await asyncio.sleep(max(0.001, t_remis))

def initialiser_profil(mode):
    global MODE_PROFIL, CONSTANTS_PHYSIQUES, VARIABLES_MOBILES
    MODE_PROFIL = mode
    v_pr, p_surf, t_surf, e_vap, alt_g = 0.0, 1013.25, 288.15, 12.0, 99.3100
    
    if mode == "AVION": alt_g, v_pr, p_surf, t_surf, e_vap = 10600.0, 250.0, 238.4, 218.8, 0.01
    elif mode == "TRAIN": alt_g, v_pr = 119.31, 83.3
    elif mode == "VOITURE": alt_g, v_pr = 99.31, 25.0
    elif mode == "BATEAU": alt_g, v_pr, e_vap = 0.0, 8.0, 22.0

    CONSTANTS_PHYSIQUES = {
        'G': 6.67430e-11, 'M_TERRE': 5.9722e24, 'OMEGA_TERRE': 7.292115e-5,
        'J2': 1.08263e-3, 'C': 299792458.0, 'vitesse_propre': v_pr,
        'pression': p_surf, 'temperature': t_surf, 'vapeur': e_vap
    }
    VARIABLES_MOBILES['pos_ecef'] = geodesiques_vers_ecef(43.284356, 5.358507, alt_g)
    print(f"[PROFIL] Initialisé : {mode} (V={v_pr} m/s, Alt={alt_g} m)")

async def main():
    mode = sys.argv[1].upper() if len(sys.argv) > 1 else "MARSEILLE_FIXE"
    initialiser_profil(mode)
    
    print("[RUN] Lancement du serveur d'infrastructure métrologique sur ws://localhost:8765")
    async with websockets.serve(handler_metrologique, "localhost", 8765):
        await asyncio.Future() # Maintien infini du serveur

if __name__ == "__main__":
    asyncio.run(main())
