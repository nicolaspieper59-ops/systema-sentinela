#!/usr/bin/env python3
"""
SYSTEMA SENTINELA — DYNAMIC MULTIPHYSICS GENERATOR (JPL DE440s Rigorous Engine v19.17)
"""

import argparse
import sys
import json
import time
import os
import numpy as np

try:
    from skyfield.api import load
except ImportError:
    print("[FATAL] Skyfield introuvable (`pip install skyfield`).", file=sys.stderr)
    sys.exit(1)

CORPS_MAP = {
    "SOLEIL": ["sun"],
    "LUNE": ["moon"],
    "MERCURE": ["mercury", "mercury barycenter"],
    "VENUS": ["venus", "venus barycenter"],
    "MARS": ["mars barycenter", "mars"],
    "JUPITER": ["jupiter barycenter"],
    "SATURNE": ["saturn barycenter"],
    "URANUS": ["uranus barycenter"],
    "NEPTUNE": ["neptune barycenter"]
}

PAS_HEURES_MAP = {
    "LUNE": 2, "MERCURE": 4, "SOLEIL": 6, "VENUS": 6,
    "MARS": 6, "JUPITER": 12, "SATURNE": 12, "URANUS": 24, "NEPTUNE": 24
}

RAYONS_EQUATORIAUX_KM = {
    "SOLEIL": 696340.0, "LUNE": 1737.4, "MERCURE": 2439.7, "VENUS": 6051.8,
    "MARS": 3396.2, "JUPITER": 71492.0, "SATURNE": 60268.0, "URANUS": 25559.0, "NEPTUNE": 24764.0
}

# Ingestion déterministe des éléments orbitaux et physiques officiels IAU/JPL
PARAMETRES_ORBITAUX = {
    "SOLEIL":  {"perihelion_ua": 0.0, "aphelion_ua": 0.0, "perigee_ua": 0.98329, "period_days": 365.256, "lod_hours": 609.6, "vel_kms": 0.0},
    "LUNE":    {"perihelion_ua": 0.00240, "aphelion_ua": 0.00271, "perigee_ua": 0.00243, "period_days": 27.321, "lod_hours": 655.7, "vel_kms": 1.022},
    "MERCURE": {"perihelion_ua": 0.3075, "aphelion_ua": 0.4667, "perigee_ua": 0.549, "period_days": 87.969, "lod_hours": 4222.6, "vel_kms": 47.36},
    "VENUS":   {"perihelion_ua": 0.7184, "aphelion_ua": 0.7282, "perigee_ua": 0.264, "period_days": 224.701, "lod_hours": 2802.0, "vel_kms": 35.02},
    "MARS":    {"perihelion_ua": 1.3814, "aphelion_ua": 1.6660, "perigee_ua": 0.372, "period_days": 686.980, "lod_hours": 24.62, "vel_kms": 24.07},
    "JUPITER": {"perihelion_ua": 4.9503, "aphelion_ua": 5.4570, "perigee_ua": 3.95, "period_days": 4332.59, "lod_hours": 9.93, "vel_kms": 13.07},
    "SATURNE": {"perihelion_ua": 9.0412, "aphelion_ua": 10.1238, "perigee_ua": 8.05, "period_days": 10759.22, "lod_hours": 10.7, "vel_kms": 9.68},
    "URANUS":  {"perihelion_ua": 18.2861, "aphelion_ua": 20.0965, "perigee_ua": 17.29, "period_days": 30688.5, "lod_hours": 17.2, "vel_kms": 6.80},
    "NEPTUNE": {"perihelion_ua": 29.8100, "aphelion_ua": 30.3271, "perigee_ua": 28.81, "period_days": 60182.0, "lod_hours": 16.1, "vel_kms": 5.43}
}

DEGRE_TCHEBYCHEV = 12
UA_KM = 149597870.7

def valider_coordonnees(lat, lon, alt):
    if not (-90.0 <= lat <= 90.0): raise ValueError(f"Latitude invalide : {lat}")
    if not (-180.0 <= lon <= 180.0): raise ValueError(f"Longitude invalide : {lon}")
    if not (-500.0 <= alt <= 100000.0): raise ValueError(f"Altitude invalide : {alt}")

def obtenir_astre(eph, noms):
    for nom in noms:
        if nom in eph: return eph[nom]
    raise KeyError(f"Astre non trouvé : {noms}")

def calculer_magnitude_apparente(nom_corps, pos_astre_km, pos_soleil_km):
    if nom_corps == "SOLEIL": 
        return -26.74

    # Vecteurs directeurs de l'angle de phase au sommet de l'astre (Astre -> Terre et Astre -> Soleil)
    r_AE = -pos_astre_km
    r_AS = pos_soleil_km - pos_astre_km
    
    norm_AE = np.linalg.norm(r_AE)
    norm_AS = np.linalg.norm(r_AS)

    if norm_AE == 0 or norm_AS == 0: 
        return 0.0

    delta_ua = norm_AE / UA_KM
    r_ua = norm_AS / UA_KM

    cos_alpha = np.dot(r_AE, r_AS) / (norm_AE * norm_AS)
    alpha_deg = np.degrees(np.arccos(np.clip(cos_alpha, -1.0, 1.0)))

    if nom_corps == "LUNE":
        alpha_clamp = np.clip(alpha_deg, 0.0, 180.0)
        return round(float(-12.73 + 0.026 * alpha_clamp + 4.0e-9 * (alpha_clamp**4)), 2)

    modeles = {
        "MERCURE": (-0.60, 0.0498 * alpha_deg),
        "VENUS":   (-4.40, 0.0009 * alpha_deg),
        "MARS":    (-1.52, 0.016 * alpha_deg),
        "JUPITER": (-9.40, 0.005 * alpha_deg),
        "SATURNE": (-8.88, 0.013 * alpha_deg),
        "URANUS":  (-7.19, 0.001 * alpha_deg),
        "NEPTUNE": (-6.87, 0.001 * alpha_deg)
    }

    if nom_corps in modeles:
        v_0, corr = modeles[nom_corps]
        return round(float(v_0 + 5.0 * np.log10(r_ua * delta_ua) + corr), 2)

    return 0.0

def calculer_segment_tchebychev(earth, astre_target, sun_target, ts, t1_unix, t2_unix, nom_corps, degre=12):
    nodes_std = np.cos(np.pi * np.arange(degre + 1) / degre)
    t_sec_nodes = 0.5 * (t2_unix - t1_unix) * nodes_std + 0.5 * (t2_unix + t1_unix)
    times_nodes = ts.tt_jd((t_sec_nodes / 86400.0) + 2440587.5)

    apparent_obs = earth.at(times_nodes).observe(astre_target).apparent()
    pos_km = apparent_obs.position.km
    vel_kms = apparent_obs.velocity.km_per_s

    cx = [float(v) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[0], degre)]
    cy = [float(v) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[1], degre)]
    cz = [float(v) for v in np.polynomial.chebyshev.chebfit(nodes_std, pos_km[2], degre)]

    cvx = [float(v) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[0], degre)]
    cvy = [float(v) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[1], degre)]
    cvz = [float(v) for v in np.polynomial.chebyshev.chebfit(nodes_std, vel_kms[2], degre)]

    t_mid_unix = 0.5 * (t1_unix + t2_unix)
    time_mid = ts.tt_jd((t_mid_unix / 86400.0) + 2440587.5)
    
    pos_astre_mid = earth.at(time_mid).observe(astre_target).apparent().position.km
    pos_soleil_mid = earth.at(time_mid).observe(sun_target).apparent().position.km
    mag_val = calculer_magnitude_apparente(nom_corps, pos_astre_mid, pos_soleil_mid)

    orb = PARAMETRES_ORBITAUX.get(nom_corps, {})

    return {
        "t_start": float(t1_unix),
        "t_end": float(t2_unix),
        "rayon_km": float(RAYONS_EQUATORIAUX_KM.get(nom_corps, 0.0)),
        "cx": cx, "cy": cy, "cz": cz,
        "cvx": cvx, "cvy": cvy, "cvz": cvz,
        "mag": float(mag_val),
        "perihelion_ua": orb.get("perihelion_ua", 0.0),
        "aphelion_ua": orb.get("aphelion_ua", 0.0),
        "perigee_ua": orb.get("perigee_ua", 0.0),
        "period_days": orb.get("period_days", 0.0),
        "lod_hours": orb.get("lod_hours", 0.0),
        "vel_kms": orb.get("vel_kms", 0.0)
    }

def generer_ephemerides(lat, lon, alt, nb_jours, bsp_path, fichier_sortie):
    valider_coordonnees(lat, lon, alt)
    if not os.path.exists(bsp_path):
        raise FileNotFoundError(f"Éphémérides JPL introuvables : {bsp_path}")

    ts = load.timescale()
    eph = load(bsp_path)
    earth = eph['earth']
    sun_target = eph['sun']

    t_start_unix = time.time()
    t_end_unix = t_start_unix + (nb_jours * 86400)
    data_output = {}

    for nom_corps, cibles in CORPS_MAP.items():
        astre = obtenir_astre(eph, cibles)
        pas_sec = PAS_HEURES_MAP.get(nom_corps, 6) * 3600.0
        segments = []
        curr_t = t_start_unix

        while curr_t < t_end_unix:
            next_t = min(curr_t + pas_sec, t_end_unix)
            seg = calculer_segment_tchebychev(earth, astre, sun_target, ts, curr_t, next_t, nom_corps, DEGRE_TCHEBYCHEV)
            segments.append(seg)
            curr_t = next_t

        data_output[nom_corps] = segments

    resultat_global = {
        "ALMANACH": {
            "generateur": "Systema Sentinela DE440s Kernel",
            "date_creation_utc": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()),
            "fenetre_jours": nb_jours,
            "station": {"latitude": float(lat), "longitude": float(lon), "altitude_m": float(alt)}
        },
        "DATA": data_output
    }

    with open(fichier_sortie, "w", encoding="utf-8") as f:
        json.dump(resultat_global, f, indent=2, ensure_ascii=False)

def main():
    parser = argparse.ArgumentParser(description="Générateur d'éphémérides JPL DE440s Rigoureux")
    parser.add_argument("lat", type=float)
    parser.add_argument("lon", type=float)
    parser.add_argument("alt", type=float)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--bsp", type=str, default="de440s.bsp")
    parser.add_argument("--out", type=str, default="flux_live.json")

    args = parser.parse_args()
    try:
        generer_ephemerides(args.lat, args.lon, args.alt, args.days, args.bsp, args.out)
        print(f"[SUCCÈS] Flux généré : {args.out}")
    except Exception as e:
        print(f"[ERREUR FATALE] {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
