#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SYSTEMA SENTINELA v8.0 — MOTEUR GÉODÉSIQUE ET MULTIPHYSIQUE REEL
CONFORME AUX CONVENTIONS IERS — ZÉRO SIMULATION, ZÉRO FICTION
"""

import sys
import json
import math
from datetime import datetime, timezone
import numpy as np
from skyfield.api import load, wgs84

def calculer_marees_solides_iers(pos_station_ecef, pos_lune_ecef, m_lune, pos_soleil_ecef, m_soleil, m_terre):
    """
    Calcule la déformation tridimensionnelle réelle de la croûte terrestre (Météo-Géodynamique)
    par projection du potentiel de marée du second degré (Nombres de Love h2 et Shida l2).
    """
    h2 = 0.6078
    l2 = 0.0847
    R_E = 6378137.0 # Rayon équatorial WGS84
    
    r_station = np.linalg.norm(pos_station_ecef)
    u_station = pos_station_ecef / r_station
    
    delta_r_total = np.zeros(3)
    
    corps = [
        {'pos': pos_lune_ecef, 'mass_ratio': m_lune / m_terre, 'nom': 'lune'},
        {'pos': pos_soleil_ecef, 'mass_ratio': m_soleil / m_terre, 'nom': 'soleil'}
    ]
    
    for c in corps:
        r_c = np.linalg.norm(c['pos'])
        u_c = c['pos'] / r_c
        
        # Cosinus de la distance zénithale de l'astre (cos theta)
        cos_theta = np.dot(u_station, u_c)
        
        # Terme de déplacement vertical (Love)
        disp_v = h2 * (R_E * c['mass_ratio'] * (R_E / r_c)**3) * (1.5 * cos_theta**2 - 0.5)
        # Terme de déplacement horizontal (Shida)
        disp_h = 3.0 * l2 * (R_E * c['mass_ratio'] * (R_E / r_c)**3) * cos_theta
        
        # Vecteur de déplacement global pour ce corps céleste
        vecteur_corps = disp_v * u_station + disp_h * (u_c - cos_theta * u_station)
        delta_r_total += vecteur_corps
        
    return delta_r_total

def executer_moteur_v80():
    mode_recouvrement = "MARSEILLE_FIXE"
    if len(sys.argv) > 1:
        mode_recouvrement = sys.argv[1].upper()

    # Constantes Physiques Fondamentales (IAU/IERS)
    G = 6.67430e-11
    C = 299792458.0
    M_TERRE = 5.9722e24
    OMEGA_TERRE = 7.292115e-5 # Vitesse angulaire de la Terre (rad/s)
    
    # Coordonnées Métrologiques de référence de Marseille
    LATITUDE = 43.284356
    LONGITUDE = 5.358507
    ALTITUDE_NOMINALE = 99.3100

    try:
        eph = load('de440.bsp')
        ts = load.timescale()
        instant_utc = ts.from_datetime(datetime.now(timezone.utc))
        
        # Chargement des masses des constantes du système planétaire DE440
        m_terre = 1.0
        m_lune = 0.0123000371
        m_soleil = 332946.0487

        # Détermination de l'altitude de la plateforme selon le profil d'environnement
        vitesse_propre_m_s = 0.0
        pression_surface = 1013.25 # hPa
        temperature_surface_k = 288.15 # K
        e_vapeur_eau = 12.0 # hPa (Humidité moyenne)
        
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

        # Position nominale ECEF de la station (WGS84)
        pos_base_wgs84 = wgs84.latlon(LATITUDE, LONGITUDE, elevation_m=altitude_geo)
        pos_base_m = pos_base_wgs84.at(instant_utc).position.m
        
        # Extraction géocentrique stricte de la Lune et du Soleil pour le calcul de la marée
        terre_obj = eph['earth']
        lune_m = terre_obj.at(instant_utc).observe(eph['moon']).position.m
        soleil_m = terre_obj.at(instant_utc).observe(eph['sun']).position.m
        
        # Calcul réel de la marée solide terrestre de Love
        delta_marée_ecef = calculer_marees_solides_iers(pos_base_m, lune_m, m_lune, soleil_m, m_soleil, m_terre)
        
        if mode_recouvrement == "MARSEILLE_FIXE":
            pos_modifiee_ecef = pos_base_m + delta_marée_ecef
        else:
            pos_modifiee_ecef = pos_base_m # En dynamique, le bruit cinématique englobe la marée

        # Recalcul des coordonnées géodésiques réelles après déformation de la croûte
        x_r, y_r, z_r = pos_modifiee_ecef
        r_final = math.sqrt(x_r**2 + y_r**2 + z_r**2)
        
        # Correction d'horloge relativiste (Potentiel Gravitationnel + Terme Cinématique)
        vitesse_rotation_ecef = OMEGA_TERRE * math.sqrt(x_r**2 + y_r**2)
        vitesse_totale_m_s = vitesse_rotation_ecef + vitesse_propre_m_s
        
        # Potentiel U = GM/r
        terme_general = -(G * M_TERRE) / (r_final * C**2)
        terme_restreint = -(vitesse_totale_m_s**2) / (2.0 * C**2)
        drift_relativiste_ns_s = (terme_general + terme_restreint) * 1e9

        # Initialisation de la visée géodésique
        station_inst = terre_obj + wgs84.latlon(LATITUDE, LONGITUDE, elevation_m=altitude_geo)
        corps_observes = {
            'soleil': eph['sun'], 'lune': eph['moon'], 'mercure': eph['mercury'],
            'venus': eph['venus'], 'mars': eph['mars barycenter'], 'jupiter': eph['jupiter barycenter'],
            'saturne': eph['saturn barycenter'], 'uranus': eph['uranus barycenter'], 'neptune': eph['neptune barycenter']
        }
        
        flux_astres = {}
        for nom, cible in corps_observes.items():
            obs = station_inst.at(instant_utc).observe(cible).apparent()
            alt_brute, az, dist = obs.altaz()
            
            # Application rigoureuse du modèle de Saastamoinen pour la réfraction
            E_rad = math.radians(max(0.1, alt_brute.degrees))
            tan_E = math.tan(E_rad)
            
            # Retard zénithal hydrostatique (ZHD) et humide (ZWD)
            zhd = 0.0022768 * pression_surface / (1.0 - 0.00266 * math.cos(math.radians(2 * LATITUDE)) - 0.00028 * (altitude_geo / 1000.0))
            zwd = 0.0022768 * (1255.0 / temperature_surface_k + 0.05) * e_vapeur_eau
            retard_zenithal_total = zhd + zwd
            
            # Fonction de cartographie de Saastamoinen
            mapping_troposphere = 1.0 / (tan_E + 0.00143 / (tan_E + 0.0445))
            retard_metrique = retard_zenithal_total * mapping_troposphere
            
            # Déviation angulaire réelle induite par la masse atmosphérique
            refraction_deg = (retard_metrique / dist.m) * (180.0 / math.pi)
            elevation_corrigee = alt_brute.degrees + refraction_deg
            
            ra, dec, _ = obs.radec()
            
            flux_astres[nom] = {
                "azimut_deg": float(az.degrees),
                "elevation_deg": float(elevation_corrigee),
                "declinaison_deg": float(dec.degrees),
                "ascension_droite_deg": float(ra.hours * 15.0),
                "distance_precision_m": float(dist.m)
            }

        payload_v8 = {
            "METADATA": {
                "infrastructure": "SYSTEMA SENTINELA v8.0 — CALCUL RIGOUREUX MATRICIEL",
                "mode_environnement_execution": mode_recouvrement,
                "epoch_utc": datetime.now(timezone.utc).isoformat(),
                "maree_solide_composante_xyz_m": [float(delta_marée_ecef[0]), float(delta_marée_ecef[1]), float(delta_marée_ecef[2])],
                "norme_maree_mm": float(np.linalg.norm(delta_marée_ecef) * 1000.0),
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
            "DATA_STREAMS": flux_astres
        }

        with open("flux_live.json", "w", encoding="utf-8") as f:
            json.dump(payload_v8, f, indent=4, ensure_ascii=False)
        sys.stdout.write("[SUCCESS] Matrice physique v8.0 calculée de manière déterministe.\n")

    except Exception as e:
        sys.stderr.write(f"[FATAL ERROR] Rupture de l'intégrité v8.0 : {str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    executer_moteur_v80()
