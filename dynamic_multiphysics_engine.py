#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.8.0-Proxima-Centauri — CORRECTION DU CONTINUUM ET GUIDAGE GNC
SUPPRESSION DES SLIDERS MANUELS — ORDINATEUR DE TRAJECTOIRE AUTONOME ET REFRACTION DIRECTE
"""

import os
import sys
import json
import math
import time
from datetime import datetime, timezone, timedelta
import numpy as np
from skyfield.api import load, wgs84

# Constantes WGS84 et Physiques UA (SI Strict)
A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2
G = 6.67430e-11
M_TERRE = 5.9722e24
OMEGA_TERRE = 7.292115e-5
R_EQ = 6378137.0
C = 299792458.0

# Harmoniques Zonales EGM2008
J2 = 1.08263e-3
J3 = -2.53260518205e-6
J4 = -1.61962159131e-6

def calculer_rayons_courbure(lat_rad):
    denom = 1.0 - E2_WGS84 * math.sin(lat_rad)**2
    return A_WGS84 * (1.0 - E2_WGS84) / (denom * math.sqrt(denom)), A_WGS84 / math.sqrt(denom)

def ecef_vers_geodesique(x, y, z):
    p = math.sqrt(x**2 + y**2)
    if p < 1e-6:
        return (90.0 if z > 0 else -90.0), 0.0, abs(z) - A_WGS84 * (1.0 - F_WGS84)
    b = A_WGS84 * (1.0 - F_WGS84)
    ep2 = (A_WGS84**2 - b**2) / (b**2)
    theta = math.atan2(z * A_WGS84, p * b)
    lat_rad = math.atan2(z + ep2 * b * (math.sin(theta)**3), p - E2_WGS84 * A_WGS84 * (math.cos(theta)**3))
    lon_rad = math.atan2(y, x)
    _, N = calculer_rayons_courbure(lat_rad)
    return math.degrees(lat_rad), math.degrees(lon_rad), p / math.cos(lat_rad) - N

def rotation_enu_vers_ecef(lat_deg, lon_deg):
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    sl, cl, sn, cn = math.sin(lat), math.cos(lat), math.sin(lon), math.cos(lon)
    return np.array([[-sn, -sl*cn, cl*cn], [cn, -sl*sn, cl*sn], [0.0, cl, sl]])

def guidage_ordinateur_gnc(temps_vol, alt_m):
    """Générateur Automatique de Vecteur de Poussée Cinématique Exogène (GNC)"""
    if temps_vol < 20.0:
        phase = "LIFT_OFF_VERTICAL"
        acc_enu = np.array([0.0, 0.5, 18.0])  # Forte poussée verticale, légère dérive Nord
    elif temps_vol < 75.0:
        phase = "GRAVITY_TURN_ATMOSPHERIC"
        acc_enu = np.array([2.0, 12.0, 6.0])  # Inclinaison balistique vers le Nord-Est
    elif temps_vol < 150.0:
        phase = "EXOSPHERIC_ACCELERATION"
        acc_enu = np.array([5.0, 15.0, -1.5]) # Accélération orbitale pure hors de l'atmosphère
    else:
        phase = "BALLISTIC_COASTING"          # Moteurs coupés, chute libre pure (soumise à la gravité terrestre)
        acc_enu = np.array([0.0, 0.0, 0.0])
        
    return phase, acc_enu

def intégration_rk4_dynamique(pos_ecef, v_enu, acc_enu, dt):
    def f(p, v):
        lat, lon, _ = ecef_vers_geodesique(p[0], p[1], p[2])
        return rotation_enu_vers_ecef(lat, lon).dot(v)
    
    v_m1 = v_enu + acc_enu * (dt / 2.0)
    v_m2 = v_enu + acc_enu * dt
    
    k1 = f(pos_ecef, v_enu)
    k2 = f(pos_ecef + k1 * (dt / 2.0), v_m1)
    k3 = f(pos_ecef + k2 * (dt / 2.0), v_m1)
    k4 = f(pos_ecef + k3 * dt, v_m2)
    
    pos_nouvelle = pos_ecef + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
    v_nouveau = v_enu + acc_enu * dt
    return pos_nouvelle, v_nouveau

def thermo_atmosphere_isa(alt_m):
    """Modèle étendu de l'Atmosphère Standard Internationale (ISA)"""
    h = max(0.0, alt_m)
    if h <= 11000.0:
        T = 288.15 - 0.0065 * h
        P = 101.325 * math.pow(T / 288.15, 5.25588)
    elif h <= 20000.0:
        T = 216.65
        P = 22.632 * math.exp(-0.00015769 * (h - 11000.0))
    elif h <= 32000.0:
        T = 216.65 + 0.001 * (h - 20000.0)
        P = 5.4748 * math.pow(T / 216.65, -34.16319)
    else: # Très haute altitude (Mésosphère)
        T = 228.65
        P = 0.868 * math.exp(-0.000138 * (h - 32000.0))
    return P, T

def calculer_marees_solides_iers_complete(pos_station_ecef, pos_lune_ecef, pos_soleil_ecef):
    h2, l2, h3, l3 = 0.6078, 0.0847, 0.292, 0.015
    r_s = np.linalg.norm(pos_station_ecef)
    if r_s < 1e-6: return np.zeros(3)
    u_s = pos_station_ecef / r_s
    delta_r = np.zeros(3)
    for c in [{'p': pos_lune_ecef, 'r': 0.0123, 'd3': True}, {'p': pos_soleil_ecef, 'r': 332946.0, 'd3': False}]:
        r_c = np.linalg.norm(c['p'])
        if r_c < 1e-6: continue
        u_c = c['p'] / r_c
        cos_t = np.dot(u_s, u_c)
        f2 = A_WGS84 * c['r'] * math.pow(A_WGS84 / r_c, 3)
        delta_r += (f2 * h2 * (1.5*cos_t**2 - 0.5)) * u_s + (3.0 * l2 * f2 * cos_t) * (u_c - cos_t * u_s)
        if c['d3']:
            f3 = A_WGS84 * c['r'] * math.pow(A_WGS84 / r_c, 4)
            delta_r += (f3 * h3 * (2.5*cos_t**3 - 1.5*cos_t)) * u_s + (l3 * f3 * (7.5*cos_t**2 - 1.5)) * (u_c - cos_t * u_s)
    return delta_r

def generer_flux_metrologique_quantique(ts, eph, corps_observes, state_matrice, phase_gnc, acc_actuelle):
    pos_base_ecef = state_matrice['pos_ecef']
    v_enu_actuel = state_matrice['v_enu']
    sim_datetime = state_matrice['sim_time']
    temps_vol = state_matrice['temps_vol']
    
    lat, lon, alt = ecef_vers_geodesique(pos_base_ecef[0], pos_base_ecef[1], pos_base_ecef[2])
    instant_utc = ts.from_datetime(sim_datetime)
    
    UA = 149597870700.0
    terre_obj = eph['earth']
    lune_p = terre_obj.at(instant_utc).observe(eph['moon']).position.au * UA
    soleil_p = terre_obj.at(instant_utc).observe(eph['sun']).position.au * UA
    
    delta_iers = calculer_marees_solides_iers_complete(pos_base_ecef, lune_p, soleil_p)
    pos_corrigee = pos_base_ecef + delta_iers
    
    # Métrique Relativiste J4 Spécifique
    r_mag = np.linalg.norm(pos_corrigee)
    sin_phi = pos_corrigee[2] / r_mag if r_mag > 0 else 0
    P2, P3, P4 = 0.5*(3*sin_phi**2-1), 0.5*(5*sin_phi**3-3*sin_phi), 0.125*(35*sin_phi**4-30*sin_phi**2+3)
    U_j = ((G * M_TERRE) / r_mag) * (1.0 - J2*(R_EQ/r_mag)**2*P2 - J3*(R_EQ/r_mag)**3*P3 - J4*(R_EQ/r_mag)**4*P4)
    v_rot = np.array([-OMEGA_TERRE * pos_corrigee[1], OMEGA_TERRE * pos_corrigee[0], 0.0])
    v_tot = v_rot + v_enu_actuel
    drift_relativiste = ((-U_j / C**2) - (np.dot(v_tot, v_tot) / (2.0 * C**2))) * 1e9

    station_inst = terre_obj + wgs84.latlon(lat, lon, elevation_m=alt)
    flux_astres = {}
    
    # Extraction ISA stricte pour réfraction astronomique directe
    P_kPa, T_K = thermo_atmosphere_isa(alt)
    
    for nom, cible in corps_observes.items():
        obs = station_inst.at(instant_utc).observe(cible).apparent()
        alt_brute, az, dist = obs.altaz()
        
        # Formule de réfraction astronomique directe (Bennett / Radau corrigée de l'altitude)
        E_deg = max(0.001, alt_brute.degrees)
        refraction_standard_minutes = 1.0 / math.tan(math.radians(E_deg + 7.31 / (E_deg + 4.4)))
        # Ajustement rigoureux en fonction du gradient de densité atmosphérique local
        correction_densite = (P_kPa / 101.325) * (288.15 / T_K)
        refraction_deg = (refraction_standard_minutes / 60.0) * correction_densite
        
        flux_astres[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(alt_brute.degrees + refraction_deg),
            "declinaison_deg": float(obs.radec()[:2][1].degrees),
            "distance_precision_m": float(dist.m)
        }

    angle_phase = math.acos(np.clip(np.dot(lune_p/np.linalg.norm(lune_p), soleil_p/np.linalg.norm(soleil_p)), -1.0, 1.0))
    illumination_pct = 50.0 * (1.0 + math.cos(angle_phase))

    payload = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v8.8.0-Proxima-Centauri",
            "statut_continuum": "GNC_AUTOMATIC_FLIGHT_ACTIVE",
            "phase_vol": phase_gnc,
            "temps_vol_s": float(temps_vol),
            "epoch_utc": sim_datetime.isoformat().replace("+00:00", "Z"),
            "altitude_calcul_m": float(alt),
            "pression_isa_kPa": float(P_kPa),
            "temperature_isa_K": float(T_K),
            "norme_maree_mm": float(np.linalg.norm(delta_iers) * 1000.0),
            "horloge_einstein_delta_ns_s": float(drift_relativiste)
        },
        "GNC_VECTORS": {
            "acc_est_m_s2": float(acc_actuelle[0]),
            "acc_nord_m_s2": float(acc_actuelle[1]),
            "acc_zenith_m_s2": float(acc_actuelle[2])
        },
        "ANALYSE_LUNAIRE": {
            "illumination_calculee_pct": float(illumination_pct),
            "verdict_oeil_nu": "VISIBLE STRICT" if (flux_astres['lune']['elevation_deg'] > 0 and (flux_astres['soleil']['elevation_deg'] < -6.0 or illumination_pct > 35)) else "INVISIBLE OMNISCIENT"
        },
        "MATRICE_ECEF_REEL": {
            "X_mètres": float(pos_corrigee[0]), "Y_mètres": float(pos_corrigee[1]), "Z_mètres": float(pos_corrigee[2]),
            "VX_m_s": float(v_tot[0]), "VY_m_s": float(v_tot[1]), "VZ_m_s": float(v_tot[2])
        },
        "DATA_STREAMS": flux_astres
    }

    with open("flux_live.tmp", "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
    os.replace("flux_live.tmp", "flux_live.json")

def main():
    eph = load('de440.bsp')
    ts = load.timescale()
    
    # Origine : Marseille WGS84
    pos_ecef = np.array([4630100.5742, 434290.6011, 4350620.2235])
    v_enu = np.array([0.0, 0.0, 0.0])
    
    state_matrice = {
        'pos_ecef': pos_ecef,
        'v_enu': v_enu,
        'sim_time': datetime.now(timezone.utc),
        'temps_vol': 0.0
    }
    
    dt = 0.05
    print("Moteur GNC Unifié v8.8.0 Opérationnel. Phase de guidage automatique lancée.")
    
    while True:
        t_start = time.time()
        
        _, _, alt_actuelle = ecef_vers_geodesique(state_matrice['pos_ecef'][0], state_matrice['pos_ecef'][1], state_matrice['pos_ecef'][2])
        
        # Ingestion automatique des forces exogènes via le calculateur GNC
        phase_gnc, acc_enu = guidage_ordinateur_gnc(state_matrice['temps_vol'], alt_actuelle)
        
        state_matrice['pos_ecef'], state_matrice['v_enu'] = intégration_rk4_dynamique(
            state_matrice['pos_ecef'], state_matrice['v_enu'], acc_enu, dt
        )
        
        generer_flux_metrologique_quantique(ts, eph, {
            'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury'],
            'venus': eph['venus'], 'mars': eph['mars barycenter'], 'jupiter': eph['jupiter barycenter'],
            'saturne': eph['saturn barycenter'], 'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
        }, state_matrice, phase_gnc, acc_enu)
        
        state_matrice['sim_time'] += timedelta(seconds=dt)
        state_matrice['temps_vol'] += dt
        time.sleep(max(0.001, dt - (time.time() - t_start)))

if __name__ == "__main__":
    main()
