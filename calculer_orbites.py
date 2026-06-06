#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import math
import sys
import os
import time
from datetime import datetime, timezone
from skyfield.api import Topos, load

if not os.path.exists('de421.bsp'):
    print("[ERREUR CRITIQUE] Le fichier de421.bsp est introuvable.")
    sys.exit(1)

EPH = load('de421.bsp')
TS = load.timescale()

ASTRES = {"SOLEIL": EPH['sun'], "LUNE": EPH['moon'], "JUPITER": EPH['jupiter barycenter']}
MAGNITUDES = {"SOLEIL": -26.74, "LUNE": -12.74, "JUPITER": -2.50}

def capter_gnss_et_environnement(timestamp_depart, index_frame):
    dt_cadre = 1.0 / 60.0
    timestamp_atomique = timestamp_depart + (index_frame * dt_cadre)
    vitesse_deg_par_seconde = 0.00356 
    lat_actuelle = 43.2891
    lon_actuelle = 5.3572 + (index_frame * dt_cadre * vitesse_deg_par_seconde)
    alt_gnss_m = 9500.0
    return timestamp_atomique, lat_actuelle, lon_actuelle, alt_gnss_m

def calculer_pression_externe_reelle(altitude_m):
    if altitude_m < 11000.0:
        return 1013.25 * math.pow(1.0 - (0.0065 * altitude_m) / 288.15, 5.255)
    return 226.32 * math.exp(-0.00015769 * (altitude_m - 11000.0))

def calculer_thermodynamique_haute_vitesse(altitude_m, vitesse_kms):
    vitesse_ms = vitesse_kms * 1000.0
    temp_statique_k = 288.15 - (0.0065 * altitude_m) if altitude_m < 11000.0 else 216.65
    vitesse_son_ms = math.sqrt(1.4 * 287.05 * temp_statique_k)
    mach = vitesse_ms / vitesse_son_ms
    temp_recup_k = temp_statique_k * (1.0 + 0.85 * 0.2 * (mach ** 2))
    return temp_statique_k - 273.15, temp_recup_k - 273.15, mach

def calculer_pesanteur_eotvos(latitude_deg, altitude_m, vitesse_kms):
    lat_rad = math.radians(latitude_deg)
    g_sol = 9.780327 * (1 + 0.0053024 * math.sin(lat_rad)**2 - 0.0000058 * math.sin(2 * math.sin(lat_rad))**2)
    g_altitude = g_sol * ((6371000.0 / (6371000.0 + altitude_m)) ** 2)
    vitesse_ms = vitesse_kms * 1000.0
    accel_eotvos = (2.0 * 7.292115e-5 * vitesse_ms * math.cos(lat_rad)) + ((vitesse_ms ** 2) / (6371000.0 + altitude_m))
    return g_altitude - accel_eotvos

def calculer_quantum_radiations(hauteur_soleil_deg, altitude_m):
    if hauteur_soleil_deg <= 0.0: return 0.0, 0.0
    cos_zenith = math.cos(math.radians(90.0 - hauteur_soleil_deg))
    if cos_zenith < 0.01: return 0.0, 0.0
    masse_air = 1.0 / cos_zenith
    attenuation_ozone = math.exp(-0.35 * masse_air)
    pression_rel = calculer_pression_externe_reelle(altitude_m) / 1013.25
    attenuation_rayleigh = math.exp(-0.15 * pression_rel * masse_air)
    indice_uv = 12.5 * attenuation_ozone * attenuation_rayleigh * cos_zenith
    facteur_eau = math.exp(-altitude_m / 2000.0)
    attenuation_ir = math.exp(-(0.08 + 0.18 * facteur_eau) * masse_air)
    flux_ir = 611.0 * attenuation_ir * cos_zenith
    return max(0.0, round(indice_uv, 2)), max(0.0, round(flux_ir, 1))

def calculer_refraction_dynamique(altitude_brute_deg, altitude_m, temp_statique_c, pression_hpa):
    if altitude_brute_deg <= 0.0: return altitude_brute_deg
    angle_rad = math.radians(altitude_brute_deg + (7.31 / (altitude_brute_deg + 4.4)))
    cotangente = 1.0 / math.tan(angle_rad)
    facteur_densite = (pression_hpa / 1013.25) * (288.15 / (temp_statique_c + 273.15))
    return altitude_brute_deg + (cotangente / 60.0) * facteur_densite

def executer_moteur_uhf():
    BUDGET_CADRE = 1.0 / 60.0
    VITESSE_KMS = 0.2775 
    historique_distances_km = {astre: None for astre in ASTRES}
    timestamp_precedent = None
    timestamp_zero = time.time()
    frame_index = 0
    
    while True:
        top_debut = time.perf_counter()
        t_atomique, lat, lon, alt_m = capter_gnss_et_environnement(timestamp_zero, frame_index)
        moment_utc = datetime.fromtimestamp(t_atomique, tz=timezone.utc)
        moment_skyfield = TS.from_datetime(moment_utc)
        
        pression_hpa = calculer_pression_externe_reelle(alt_m)
        t_stat, t_paroi, mach = calculer_thermodynamique_haute_vitesse(alt_m, VITESSE_KMS)
        g_effective = calculer_pesanteur_eotvos(lat, alt_m, VITESSE_KMS)
        
        position_mobile = EPH['earth'] + Topos(latitude_degrees=lat, longitude_degrees=lon, elevation_m=alt_m)
        
        flux_60hz = {
            "CLOCK_3D": {
                "utc_gnss_atomique": moment_utc.strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],
                "coordonnees": {"lat": round(lat, 5), "lon": round(lon, 5), "alt_m": round(alt_m, 1)}
            },
            "ENVIRONNEMENT": {
                "pression_externe_hpa": round(pression_hpa, 1),
                "temperature_air_c": round(t_stat, 2),
                "temperature_paroi_c": round(t_paroi, 2),
                "vitesse_mach": round(mach, 3),
                "pesanteur_eotvos_ms2": round(g_effective, 3)
            }
        }
        
        delta_t = (t_atomique - timestamp_precedent) if timestamp_precedent else BUDGET_CADRE
        if delta_t <= 0: delta_t = BUDGET_CADRE
        
        for nom_astre, objet_jpl in ASTRES.items():
            observation = position_mobile.at(moment_skyfield).observe(objet_jpl).apparent()
            alt, az, distance = observation.altaz()
            elevation_corrigee = calculer_refraction_dynamique(alt.degrees, alt_m, t_stat, pression_hpa)
            dist_actuelle_km = distance.km
            dist_prec = historique_distances_km[nom_astre]
            vitesse_radiale = (dist_actuelle_km - dist_prec) / delta_t if dist_prec is not None else 0.0
            historique_distances_km[nom_astre] = dist_actuelle_km
            
            flux_60hz[nom_astre] = [
                round(az.degrees, 4), round(elevation_corrigee, 4),
                MAGNITUDES[nom_astre], round(distance.au, 6), round(vitesse_radiale, 3)
            ]
        
        indice_uv, flux_ir = calculer_quantum_radiations(flux_60hz["SOLEIL"][1], alt_m)
        flux_60hz["ENVIRONNEMENT"]["indice_uv"] = indice_uv
        flux_60hz["ENVIRONNEMENT"]["flux_infrarouge_wm2"] = flux_ir
        
        timestamp_precedent = t_atomique
        
        with open("orbites.json", "w", encoding="utf-8") as f:
            json.dump(flux_60hz, f, separators=(',', ':'))
            
        frame_index += 1
        temps_calcul = time.perf_counter() - top_debut
        if BUDGET_CADRE - temps_calcul > 0:
            time.sleep(BUDGET_CADRE - temps_calcul)

if __name__ == "__main__":
    executer_moteur_uhf()
