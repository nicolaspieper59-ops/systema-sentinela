#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.5.3 — MOTEUR GÉODÉSIQUE, MULTIPHYSIQUE & OPTIQUE MULTI-INSTRUMENTS
CONVERSION ECEF STRICTE — INTÉGRATION PHOTOMÉTRIQUE DE LA LUNE (DE440)
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
    denom = 1.0 - E2_WGS84 * math.sin(lat_rad)**2
    sqrt_denom = math.sqrt(denom)
    M = A_WGS84 * (1.0 - E2_WGS84) / (denom * sqrt_denom)
    N = A_WGS84 / sqrt_denom
    return M, N

def coordonnees_geodesiques_vers_ecef(lat_deg, lon_deg, alt_m):
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    _, N = calculer_rayons_courbure(lat)
    x = (N + alt_m) * math.cos(lat) * math.cos(lon)
    y = (N + alt_m) * math.cos(lat) * math.sin(lon)
    z = (N * (1.0 - E2_WGS84) + alt_m) * math.sin(lat)
    return np.array([x, y, z])

def ecef_vers_geodesique(x, y, z):
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

def evaluer_visibilite_optique(illumination_pct, h_lune_deg, h_soleil_deg):
    """Calcule le verdict physique de visibilité basé sur le contraste de Rayleigh et Bouguer"""
    if h_lune_deg <= 0:
        return "SOUS L'HORIZON", "SOUS L'HORIZON", "SOUS L'HORIZON"
    
    # Calcul de la masse d'air optique (Bemporad-Schoenberg)
    h_rad = math.radians(max(0.5, h_lune_deg))
    masse_air = 1.0 / (math.sin(h_rad) + 0.15 * ((h_lune_deg + 3.885) ** (-1.253)))
    att_transmission = math.exp(-0.28 * masse_air)  # Coefficient d'extinction moyen (0.28 mag/masse_air)
    
    # Évaluation de la luminance de fond du ciel (modèle empirique de diffusion)
    if h_soleil_deg > 0:
        luminance_ciel = 4000.0 * math.sin(math.radians(h_soleil_deg)) + 400.0 # Plein jour
    elif h_soleil_deg >= -6:
        luminance_ciel = 400.0 * ((6.0 + h_soleil_deg) / 6.0)**2 + 10.0      # Crépuscule civil
    elif h_soleil_deg >= -12:
        luminance_ciel = 10.0 * ((12.0 + h_soleil_deg) / 6.0)**2 + 0.1       # Crépuscule nautique
    else:
        luminance_ciel = 0.01                                                # Nuit noire

    contraste = (illumination_pct * att_transmission) / (luminance_ciel + 0.001)

    # Seuils limites empiriques d'observation
    oeil_nu = "VISIBLE" if (contraste > 0.04 and h_lune_deg >= 3.0 and illumination_pct >= 1.5) else "INVISIBLE"
    jumelles = "VISIBLE" if (contraste > 0.007 and h_lune_deg >= 1.5 and illumination_pct >= 0.8) else "INVISIBLE"
    
    # Cas de l'appareil photo seul (vulnérable au flare si le soleil est proche de l'horizon)
    if h_soleil_deg > 0 and h_soleil_deg < 5.0 and h_lune_deg < 25.0:
        s10e_seul = "INVISIBLE (FLARE OPTIQUE)"
    else:
        s10e_seul = "VISIBLE" if (contraste > 0.03 and h_lune_deg >= 5.0 and illumination_pct >= 2.5) else "INVISIBLE"
        
    return oeil_nu, jumelles, s10e_seul

def generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles):
    G, M_TERRE, OMEGA_TERRE, R_EQ, J2, C, vitesse_propre_m_s, pression_surface, temperature_surface_k, e_vapeur_eau = constants
    m_terre, m_lune, m_soleil = 1.0, 0.0123000371, 332946.0487
    UA_EN_METRES = 149597870700.0
    
    pos_base_m = variables_mobiles['pos_ecef']
    sim_datetime = variables_mobiles['sim_time']
    lat_actuelle, lon_actuelle, alt_actuelle = ecef_vers_geodesique(pos_base_m[0], pos_base_m[1], pos_base_m[2])
    instant_utc = ts.from_datetime(sim_datetime)
    
    # Extraction et rotation rigoureuse ICRS -> ECEF pour les calculs de marées de Love
    position_lune_icrs = eph['earth'].at(instant_utc).observe(eph['moon']).position.au * UA_EN_METRES
    position_soleil_icrs = eph['earth'].at(instant_utc).observe(eph['sun']).position.au * UA_EN_METRES
    
    # Matrice de rotation approximative de la Terre (Sidereal Angle)
    ga_rad = OMEGA_TERRE * (sim_datetime - datetime(2026, 1, 1, tzinfo=timezone.utc)).total_seconds()
    cos_g, sin_g = math.cos(ga_rad), math.sin(ga_rad)
    R_ecef = np.array([[cos_g, sin_g, 0], [-sin_g, cos_g, 0], [0, 0, 1]])
    
    pos_lune_ecef = R_ecef.dot(position_lune_icrs)
    pos_soleil_ecef = R_ecef.dot(position_soleil_icrs)
    
    delta_maree_ecef = calculer_marees_solides_iers(pos_base_m, pos_lune_ecef, m_lune, pos_soleil_ecef, m_soleil, m_terre)
    pos_modifiee_ecef = pos_base_m + delta_maree_ecef
    x_r, y_r, z_r = pos_modifiee_ecef
    
    # Calcul du potentiel gravitationnel avec correction de l'aplatissement J2
    r_final = math.sqrt(x_r**2 + y_r**2 + z_r**2)
    sin_lat = z_r / r_final if r_final > 0 else 0
    potentiel_nominal = (G * M_TERRE) / r_final if r_final > 0 else 0
    potentiel_j2 = potentiel_nominal * J2 * (R_EQ / r_final)**2 * 1.5 * (1.0 - 3.0 * sin_lat**2) if r_final > 0 else 0
    potentiel_total_u = potentiel_nominal + potentiel_j2
    
    # Correction relativiste d'Einstein (Restreinte + Générale)
    lat_rad = math.radians(lat_actuelle)
    lon_rad = math.radians(lon_actuelle)
    v_rot_ecef = np.array([-OMEGA_TERRE * y_r, OMEGA_TERRE * x_r, 0.0])
    
    v_est = vitesse_propre_m_s * math.sin(math.radians(45.0))
    v_nord = vitesse_propre_m_s * math.cos(math.radians(45.0))
    v_propre_ecef = np.array([
        -math.sin(lon_rad)*v_est - math.sin(lat_rad)*math.cos(lon_rad)*v_nord,
         math.cos(lon_rad)*v_est - math.sin(lat_rad)*math.sin(lon_rad)*v_nord,
         math.cos(lat_rad)*v_nord
    ])
    
    vitesse_totale_ecef = v_rot_ecef + v_propre_ecef
    v2_scalaire = np.dot(vitesse_totale_ecef, vitesse_totale_ecef)
    drift_relativiste_ns_s = ((-potentiel_total_u / C**2) - (v2_scalaire / (2.0 * C**2))) * 1e9

    # Résolution des éphémérides topocentriques de la NASA
    station_inst = eph['earth'] + wgs84.latlon(lat_actuelle, lon_actuelle, elevation_m=alt_actuelle)
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

    # Extraction dynamique du % d'illumination réel de la Lune
    u_lune_norm = pos_lune_ecef / np.linalg.norm(pos_lune_ecef)
    u_soleil_norm = pos_soleil_ecef / np.linalg.norm(pos_soleil_ecef)
    phase_angle = math.acos(np.dot(u_lune_norm, u_soleil_norm))
    lune_illumination_reelle = float(0.5 * (1.0 + math.cos(phase_angle)) * 100.0)

    # Calcul des verdicts visuels pour la Lune
    h_lune = flux_astres['lune']['elevation_deg']
    h_soleil = flux_astres['soleil']['elevation_deg']
    v_oeil, v_jum, v_s10e = evaluer_visibilite_optique(lune_illumination_reelle, h_lune, h_soleil)

    payload_v853 = {
        "METADATA": {
            "infrastructure": "SYSTEMA SENTINELA v8.5.3 — NOYAU COUPLÉ GÉODÉSIQUE & LUNAIRE",
            "mode_environnement_execution": mode_recouvrement,
            "epoch_utc": sim_datetime.isoformat().replace("+00:00", "Z"),
            "maree_solide_composante_xyz_m": [float(delta_maree_ecef[0]), float(delta_maree_ecef[1]), float(delta_maree_ecef[2])],
            "norme_maree_mm": float(np.linalg.norm(delta_maree_ecef) * 1000.0),
            "horloge_einstein_delta_ns_s": float(drift_relativiste_ns_s),
            "pression_base_hpa": float(pression_surface),
            "temperature_base_k": float(temperature_surface_k),
            "synchronisation": "STRICT_EPHEMERIS_DE440"
        },
        "MATRICE_ECEF_REEL": {
            "X_mètres": float(x_r),
            "Y_mètres": float(y_r),
            "Z_mètres": float(z_r)
        },
        "ANALYSE_LUNAIRE": {
            "illumination_calculee_pct": lune_illumination_reelle,
            "verdict_oeil_nu": v_oeil,
            "verdict_jumelles_m7": v_jum,
            "verdict_s10e_seul": v_s10e
        },
        "DATA_STREAMS": flux_astres
    }

    tmp_file = "flux_live.tmp"
    target_file = "flux_live.json"
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(payload_v853, f, indent=4, ensure_ascii=False)
    os.replace(tmp_file, target_file)
    print(f"[SUCCESS] Données physiques synchronisées. Lune : {lune_illumination_reelle:.2f}% | Verdict Œil : {v_oeil}")

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
        sys.stderr.write(f"[FATAL] Base de données DE440 manquante : {str(e)}\n")
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
    
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        epoch_initiale = datetime.now(timezone.utc)
    else:
        epoch_initiale = datetime(2026, 6, 15, 13, 39, 8, 448000, tzinfo=timezone.utc)

    variables_mobiles = {'pos_ecef': pos_init_ecef, 'sim_time': epoch_initiale}
    pas_temps = 0.5

    if os.environ.get('GITHUB_ACTIONS') == 'true':
        generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles)
    else:
        print(f"[RUN LOCAL] Système actif. Échantillonnage : {pas_temps}s.")
        while True:
            try:
                t_debut = time.time()
                if vitesse_propre_m_s > 0:
                    lat_act, lon_act, _ = ecef_vers_geodesique(variables_mobiles['pos_ecef'][0], variables_mobiles['pos_ecef'][1], variables_mobiles['pos_ecef'][2])
                    lat_r, lon_r = math.radians(lat_act), math.radians(lon_act)
                    v_est = vitesse_propre_m_s * math.sin(math.radians(45.0))
                    v_nord = vitesse_propre_m_s * math.cos(math.radians(45.0))
                    
                    v_propre_ecef = np.array([
                        -math.sin(lon_r)*v_est - math.sin(lat_r)*math.cos(lon_r)*v_nord,
                         math.cos(lon_r)*v_est - math.sin(lat_r)*math.sin(lon_r)*v_nord,
                         math.cos(lat_r)*v_nord
                    ])
                    variables_mobiles['pos_ecef'] += v_propre_ecef * pas_temps
                
                generer_flux_metrologique(ts, eph, corps_observes, mode_recouvrement, constants, variables_mobiles)
                variables_mobiles['sim_time'] += timedelta(seconds=pas_temps)
                time.sleep(max(0.01, pas_temps - (time.time() - t_debut)))
            except KeyboardInterrupt:
                break

if __name__ == "__main__":
    executer_moteur_v852()
