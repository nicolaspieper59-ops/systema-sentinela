#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.9.0-Singularity — NOYAU HARD SCIENCE
GNC AVEC GRAVITÉ DE SOMIGLIANA, CORRECTION TENSORIELLE ECEF ET SÉCURITÉ ATOMIQUE
"""

import os
import sys
import json
import math
import time
from datetime import datetime, timezone, timedelta
import numpy as np
from skyfield.api import load, wgs84

A_WGS84 = 6378137.0           
F_WGS84 = 1.0 / 298.257223563 
E2_WGS84 = 2.0 * F_WGS84 - F_WGS84**2
G, M_TERRE, OMEGA_TERRE, R_EQ, C = 6.67430e-11, 5.9722e24, 7.292115e-5, 6378137.0, 299792458.0
J2, J3, J4 = 1.08263e-3, -2.53260518e-6, -1.61962159e-6

def calculer_rayons_courbure(lat_rad):
    denom = 1.0 - E2_WGS84 * math.sin(lat_rad)**2
    return A_WGS84 * (1.0 - E2_WGS84) / (denom * math.sqrt(denom)), A_WGS84 / math.sqrt(denom)

def coordonnees_geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    lat, lon = math.radians(lat_deg), math.radians(lon_deg)
    _, N = calculer_rayons_courbure(lat)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return np.array([x, y, z])

def ecef_vers_geodesique(x, y, z):
    p = math.sqrt(x**2 + y**2)
    if p < 1e-6: return (90.0 if z > 0 else -90.0), 0.0, abs(z) - A_WGS84 * (1.0 - F_WGS84)
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

def guidage_ordinateur_gnc(temps_vol):
    """Séquence de vol balistique automatique"""
    if temps_vol < 15.0:
        return "LIFT_OFF", np.array([0.0, 0.5, 25.0]) # Poussée verticale intense
    elif temps_vol < 60.0:
        return "GRAVITY_TURN", np.array([5.0, 20.0, 15.0]) # Inclinaison
    elif temps_vol < 110.0:
        return "ORBITAL_INJECT", np.array([12.0, 35.0, 2.0]) # Poussée horizontale
    else:
        return "BALLISTIC_COASTING", np.array([0.0, 0.0, 0.0]) # Coupure moteur

def intégration_rk4_dynamique(pos_ecef, v_enu_actuel, acc_poussee_enu, dt):
    """Intégrateur RK4 incluant le champ de gravité local (Somigliana)"""
    lat, lon, alt = ecef_vers_geodesique(pos_ecef[0], pos_ecef[1], pos_ecef[2])
    
    # Équation de Somigliana rigoureuse pour la gravité terrestre
    sin2 = math.sin(math.radians(lat))**2
    g_local = 9.78032677 * (1 + 0.00527904 * sin2 + 0.00002327 * sin2**2) - (3.086e-6 * alt)
    
    # Accélération Nette = Poussée Moteurs + Gravité Vectorielle Zénithale
    acc_nette_enu = acc_poussee_enu + np.array([0.0, 0.0, -g_local])
    
    def f_v_ecef(p, v_e):
        l, ln, _ = ecef_vers_geodesique(p[0], p[1], p[2])
        return rotation_enu_vers_ecef(l, ln).dot(v_e)
        
    v_m1 = v_enu_actuel + acc_nette_enu * (dt / 2.0)
    v_m2 = v_enu_actuel + acc_nette_enu * dt
    
    k1 = f_v_ecef(pos_ecef, v_enu_actuel)
    k2 = f_v_ecef(pos_ecef + k1 * (dt / 2.0), v_m1)
    k3 = f_v_ecef(pos_ecef + k2 * (dt / 2.0), v_m1)
    k4 = f_v_ecef(pos_ecef + k3 * dt, v_m2)
    
    pos_nouvelle = pos_ecef + (dt / 6.0) * (k1 + 2.0 * k2 + 2.0 * k3 + k4)
    v_nouvelle = v_enu_actuel + acc_nette_enu * dt
    
    # Contrôle de collision au sol (Niveau Marseille)
    l_n, ln_n, alt_n = ecef_vers_geodesique(pos_nouvelle[0], pos_nouvelle[1], pos_nouvelle[2])
    if alt_n <= 99.310 and v_nouvelle[2] < 0:
        pos_nouvelle = coordonnees_geodesiques_vers_ecef(l_n, ln_n, 99.310)
        v_nouvelle = np.zeros(3)
        
    return pos_nouvelle, v_nouvelle

def thermo_atmosphere_isa(alt_m):
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
    else: 
        T = 228.65
        P = 0.868 * math.exp(-0.000138 * (h - 32000.0))
    return P, T

def calculer_marees_solides_iers(pos_station, pos_lune, pos_soleil):
    h2, l2, h3, l3 = 0.6078, 0.0847, 0.292, 0.015
    r_s = np.linalg.norm(pos_station)
    if r_s < 1e-6: return np.zeros(3)
    u_s = pos_station / r_s
    delta_r = np.zeros(3)
    for c in [{'p': pos_lune, 'r': 0.0123, 'd3': True}, {'p': pos_soleil, 'r': 332946.0, 'd3': False}]:
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

def generer_flux_metrologique(ts, eph, corps, state, phase_gnc, acc_poussee):
    pos_ecef, v_enu = state['pos_ecef'], state['v_enu']
    sim_time = state['sim_time']
    lat, lon, alt = ecef_vers_geodesique(pos_ecef[0], pos_ecef[1], pos_ecef[2])
    instant_utc = ts.from_datetime(sim_time)
    
    UA = 149597870700.0
    t_obj = eph['earth']
    lune_p = t_obj.at(instant_utc).observe(eph['moon']).position.au * UA
    soleil_p = t_obj.at(instant_utc).observe(eph['sun']).position.au * UA
    
    delta_iers = calculer_marees_solides_iers(pos_ecef, lune_p, soleil_p)
    pos_cor = pos_ecef + delta_iers
    
    # CORRECTION HARD SCIENCE: Addition des vecteurs vélocité dans le MEME référentiel (ECEF)
    v_rot_ecef = np.array([-OMEGA_TERRE * pos_cor[1], OMEGA_TERRE * pos_cor[0], 0.0])
    R_enu_ecef = rotation_enu_vers_ecef(lat, lon)
    v_propre_ecef = R_enu_ecef.dot(v_enu)
    v_tot_ecef = v_rot_ecef + v_propre_ecef
    
    r_mag = np.linalg.norm(pos_cor)
    sin_phi = pos_cor[2] / r_mag if r_mag > 0 else 0
    P2, P3, P4 = 0.5*(3*sin_phi**2-1), 0.5*(5*sin_phi**3-3*sin_phi), 0.125*(35*sin_phi**4-30*sin_phi**2+3)
    U_j = ((G * M_TERRE) / r_mag) * (1.0 - J2*(R_EQ/r_mag)**2*P2 - J3*(R_EQ/r_mag)**3*P3 - J4*(R_EQ/r_mag)**4*P4)
    
    drift_relativiste = ((-U_j / C**2) - (np.dot(v_tot_ecef, v_tot_ecef) / (2.0 * C**2))) * 1e9

    station_inst = t_obj + wgs84.latlon(lat, lon, elevation_m=alt)
    flux_astres = {}
    P_kPa, T_K = thermo_atmosphere_isa(alt)
    
    for nom, cible in corps.items():
        obs = station_inst.at(instant_utc).observe(cible).apparent()
        alt_brute, az, dist = obs.altaz()
        
        E_deg = max(0.001, alt_brute.degrees)
        refraction_standard_minutes = 1.0 / math.tan(math.radians(E_deg + 7.31 / (E_deg + 4.4)))
        correction_densite = (P_kPa / 101.325) * (288.15 / T_K)
        refraction_deg = (refraction_standard_minutes / 60.0) * correction_densite
        
        flux_astres[nom] = {
            "azimut_deg": float(az.degrees),
            "elevation_deg": float(alt_brute.degrees + refraction_deg),
            "declinaison_deg": float(obs.radec()[:2][1].degrees),
            "distance_precision_m": float(dist.m)
        }

    angle_phase = math.acos(np.clip(np.dot(lune_p/np.linalg.norm(lune_p), soleil_p/np.linalg.norm(soleil_p)), -1.0, 1.0))
    illum_pct = 50.0 * (1.0 + math.cos(angle_phase))

    payload = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v8.9.0-Singularity",
            "statut_continuum": "GNC_RK4_SOMIGLIANA_GRAVITY",
            "phase_vol": phase_gnc,
            "temps_vol_s": float(state['temps_vol']),
            "epoch_utc": sim_time.isoformat().replace("+00:00", "Z"),
            "altitude_calcul_m": float(alt),
            "pression_isa_kPa": float(P_kPa),
            "temperature_isa_K": float(T_K),
            "norme_maree_mm": float(np.linalg.norm(delta_iers) * 1000.0),
            "horloge_einstein_delta_ns_s": float(drift_relativiste)
        },
        "GNC_VECTORS": {
            "acc_est_m_s2": float(acc_poussee[0]),
            "acc_nord_m_s2": float(acc_poussee[1]),
            "acc_zenith_m_s2": float(acc_poussee[2])
        },
        "ANALYSE_LUNAIRE": {
            "illumination_calculee_pct": float(illum_pct),
            "verdict_oeil_nu": "VISIBLE" if (flux_astres['lune']['elevation_deg'] > 0 and (flux_astres['soleil']['elevation_deg'] < -6.0 or illum_pct > 35)) else "INVISIBLE"
        },
        "MATRICE_ECEF_REEL": {
            "X_mètres": float(pos_cor[0]), "Y_mètres": float(pos_cor[1]), "Z_mètres": float(pos_cor[2]),
            "VX_m_s": float(v_tot_ecef[0]), "VY_m_s": float(v_tot_ecef[1]), "VZ_m_s": float(v_tot_ecef[2])
        },
        "DATA_STREAMS": flux_astres
    }

    # Écriture atomique sécurisée
    tmp_file = "flux_live.tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=4, ensure_ascii=False)
    os.replace(tmp_file, "flux_live.json")

def main():
    eph = load('de440.bsp')
    ts = load.timescale()
    
    state = {
        'pos_ecef': np.array([4630100.5742, 434290.6011, 4350620.2235]),
        'v_enu': np.array([0.0, 0.0, 0.0]),
        'sim_time': datetime.now(timezone.utc),
        'temps_vol': 0.0
    }
    
    corps = {
        'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury'],
        'venus': eph['venus'], 'mars': eph['mars barycenter'], 'jupiter': eph['jupiter barycenter'],
        'saturne': eph['saturn barycenter'], 'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
    }
    
    dt = 0.05
    print("Moteur v8.9.0-Singularity activé. Attente de la télémétrie GNC...")
    
    while True:
        t_start = time.time()
        
        phase_gnc, acc_poussee = guidage_ordinateur_gnc(state['temps_vol'])
        
        state['pos_ecef'], state['v_enu'] = intégration_rk4_dynamique(
            state['pos_ecef'], state['v_enu'], acc_poussee, dt
        )
        
        generer_flux_metrologique(ts, eph, corps, state, phase_gnc, acc_poussee)
        
        state['sim_time'] += timedelta(seconds=dt)
        state['temps_vol'] += dt
        time.sleep(max(0.001, dt - (time.time() - t_start)))

if __name__ == "__main__":
    main()
